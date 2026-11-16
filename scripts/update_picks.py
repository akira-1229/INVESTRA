#!/usr/bin/env python3
"""AI におすすめ投資先を聞いて data/<provider>.json を更新する。

使い方:
  python3 scripts/update_picks.py gemini  [--context ニュース要約.txt] [--dry-run]

- gemini : Gemini API（無料枠）。キーは環境変数 GEMINI_API_KEY。Claude のクラウド環境では
           ネットワークのプロキシがキーを差し込むので未設定でよい。
"""
import argparse, datetime, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path

PROVIDERS = {
    "gemini": {
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "models": ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"],  # 無料枠で使えるもの。混雑時は順に
        "key_env": "GEMINI_API_KEY",
    },
}
DATA = Path(__file__).resolve().parent.parent / "data"
JST = datetime.timezone(datetime.timedelta(hours=9))

SCHEMA = """{
  "summary": "全体方針（2〜3文）。最後に「今週の変更: …」を一言",
  "picks": [
    {
      "name": "正式名",
      "short": "短い表示名（8文字程度まで）",
      "ticker": "米国株はティッカー、日本株は4桁コード、投信は通称",
      "type": "投資信託 / 日本株 / 米国株 / ETF など",
      "horizon": "短期 / 中期（2〜3年） / 中長期（3〜5年） / 長期（10年以上）",
      "risk": "低 / 中 / 高",
      "allocation": 20,
      "thesis": "推す理由（2文程度）"
    }
  ],
  "stocksSummary": "個別株ランキングの方針（1〜2文）。最後に「今週の変更: …」を一言",
  "stocks": [
    { 上の picks と同じ形式。ただし個別企業の株だけ（投資信託・ETF・債券・金は入れない）。
      allocation は個別株に回す資金の中での配分（合計100） }
  ]
}"""


def build_prompt(today, previous, context):
    p = [
        f"今日は {today} です。あなたは日本在住の個人投資家（新NISA利用、長期目線）向けのアドバイザーです。",
        "あなた自身の判断で、(1) ポートフォリオ全体のおすすめ投資先（picks）を5〜7件、"
        "(2) それとは別に、オルカンやS&P500などの長期インデックスとは別枠で買う『個別株』のランキング（stocks）を5〜7件、"
        "それぞれ配分(%)を決めてください。個別株は日本株・米国株などの個別企業に限ります。",
        "条件: picks と stocks それぞれで allocation の合計は100、配分の大きい順に並べる。日本の証券会社で買えるものに限る。"
        "確かでない数値（株価など）は書かない。",
    ]
    if previous and previous.get("picks"):
        prev = {k: previous.get(k) for k in ("summary", "picks", "stocksSummary", "stocks") if previous.get(k)}
        p.append("参考: 先週のあなたの回答は以下です。理由がなければ無理に入れ替えなくて構いません。\n"
                 + json.dumps(prev, ensure_ascii=False))
    if context:
        p.append("参考: 今週の市場ニュース（事実のみ）:\n" + context)
    p.append("出力は次の形式のJSONだけにしてください（説明文やコードブロックは不要）:\n" + SCHEMA)
    return "\n\n".join(p)


def call(url, model, prompt, key, extra_headers=None):
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}],
               "response_format": {"type": "json_object"}}
    if "gpt-5" not in model:  # gpt-5 系は temperature 指定不可
        payload["temperature"] = 0.4
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", **(extra_headers or {})}
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers)
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read().decode("utf-8", "replace")
    try:
        content = json.loads(raw)["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise ValueError(f"unexpected response: {raw[:300]!r}")
    if not content or not content.strip():
        raise ValueError(f"empty content: {raw[:300]!r}")
    return content


def ask(cfg, prompt):
    key = os.environ.get(cfg["key_env"]) or "proxy-injected"
    last = None
    targets = [(u, m) for u in [cfg["url"], *cfg.get("fallback_urls", [])] for m in cfg["models"]]
    for url, model in targets:
        if url != cfg["url"]:
            model = model.split("/")[-1]  # 旧エンドポイントは "gpt-4o" のような名前
        for attempt in range(3):
            try:
                return model, call(url, model, prompt, key, cfg.get("headers"))
            except urllib.error.HTTPError as e:
                last = f"{model}: HTTP {e.code} {e.read()[:300]!r}"
                if e.code in (429, 500, 503):
                    time.sleep(20 * (attempt + 1)); continue
                break  # 400/401/404 などは次のモデルへ
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                last = f"{model}: {e}"; break  # 時間切れ・変な応答は次のモデルへ
        print("fallback:", last, file=sys.stderr)
    sys.exit(f"API の呼び出しに失敗しました: {last}")


FUND_WORDS = ("投資信託", "ETF", "インデックス", "債券", "国債", "REIT", "上場投信", "ファンド", "ゴールド")


def normalize(items, min_n=3):
    picks = [p for p in (items or []) if isinstance(p, dict) and p.get("name")]
    if not min_n <= len(picks) <= 10:
        raise ValueError(f"銘柄数がおかしい: {len(picks)}")
    for p in picks:
        if p.get("risk") not in ("低", "中", "高"):
            p.pop("risk", None)
        try:
            p["allocation"] = round(float(p.get("allocation", 0)))
        except (TypeError, ValueError):
            p["allocation"] = 0
    total = sum(p["allocation"] for p in picks)
    if total and total != 100:  # 合計を100にそろえる（端数は最大の銘柄で調整）
        for p in picks:
            p["allocation"] = round(p["allocation"] * 100 / total)
        picks.sort(key=lambda p: -p["allocation"])
        picks[0]["allocation"] += 100 - sum(p["allocation"] for p in picks)
    picks.sort(key=lambda p: -p["allocation"])
    keys = ["name", "short", "ticker", "type", "horizon", "risk", "allocation", "thesis"]
    return [{k: p[k] for k in keys if p.get(k) not in (None, "")} for p in picks]


def parse(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    d = json.loads(text)
    picks = normalize(d.get("picks"))
    # 個別株: 投信・ETFなどが紛れていたら外す
    raw = [x for x in (d.get("stocks") or []) if isinstance(x, dict)
           and not any(w in str(x.get("type", "")) for w in FUND_WORDS)]
    stocks = normalize(raw) if raw else []
    return (str(d.get("summary", "")).strip(), picks,
            str(d.get("stocksSummary", "")).strip(), stocks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("provider", choices=PROVIDERS)
    ap.add_argument("--context", help="今週の市場ニュース要約（テキストファイル）")
    ap.add_argument("--dry-run", action="store_true", help="書き込まずに表示だけ")
    a = ap.parse_args()
    cfg, out_path = PROVIDERS[a.provider], DATA / f"{a.provider}.json"
    today = datetime.datetime.now(JST).date().isoformat()
    previous = json.loads(out_path.read_text()) if out_path.exists() else None
    context = Path(a.context).read_text().strip() if a.context and Path(a.context).exists() else ""
    prompt = build_prompt(today, previous, context)
    for _ in range(len(cfg["models"])):
        model, text = ask(cfg, prompt)
        try:
            summary, picks, stocks_summary, stocks = parse(text)
            break
        except (ValueError, KeyError, TypeError) as e:  # JSONが壊れていたらそのモデルを外して再挑戦
            print(f"parse failed with {model}: {e}; text={text[:200]!r}", file=sys.stderr)
            cfg = {**cfg, "models": [m for m in cfg["models"] if m != model]}
            if not cfg["models"]:
                sys.exit("どのモデルの回答も読み取れませんでした")
    else:
        sys.exit("どのモデルの回答も読み取れませんでした")
    out = {"updatedAt": today, "model": model, "summary": summary, "picks": picks}
    if stocks:
        out.update({"stocksUpdatedAt": today, "stocksSummary": stocks_summary, "stocks": stocks})
    s = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    if a.dry_run:
        print(s)
    else:
        out_path.write_text(s); print(f"updated {out_path} with {model}: {len(picks)} picks, {len(stocks)} stocks")


if __name__ == "__main__":
    main()
