#!/usr/bin/env python3
"""Gemini API におすすめ投資先を聞いて data/gemini.json を更新する。

使い方:
  python3 scripts/update_gemini.py [--context ニュース要約.txt] [--dry-run]

APIキーは環境変数 GEMINI_API_KEY から読む。クラウド環境ではネットワークの
プロキシがキーを差し込むので、未設定なら仮の値で送る（中身は置き換えられる）。
"""
import argparse, datetime, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path

URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
MODELS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"]  # 無料枠で使えるもの。混雑時は順に切り替え
OUT = Path(__file__).resolve().parent.parent / "data" / "gemini.json"
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
  ]
}"""


def build_prompt(today, previous, context):
    p = [
        f"今日は {today} です。あなたは日本在住の個人投資家（新NISA利用、長期目線）向けのアドバイザーです。",
        "あなた自身の判断で、今おすすめする投資先を5〜7件選び、配分(%)を決めてください。",
        "条件: allocation の合計は100、配分の大きい順に並べる。日本の証券会社で買えるものに限る。"
        "確かでない数値（株価など）は書かない。",
    ]
    if previous and previous.get("picks"):
        p.append("参考: 先週のあなたの回答は以下です。理由がなければ無理に入れ替えなくて構いません。\n"
                 + json.dumps({"summary": previous.get("summary"), "picks": previous["picks"]}, ensure_ascii=False))
    if context:
        p.append("参考: 今週の市場ニュース（事実のみ）:\n" + context)
    p.append("出力は次の形式のJSONだけにしてください（説明文やコードブロックは不要）:\n" + SCHEMA)
    return "\n\n".join(p)


def call(model, prompt, key):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.4,
    }).encode()
    req = urllib.request.Request(URL, body, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def ask(prompt):
    key = os.environ.get("GEMINI_API_KEY", "proxy-injected")
    last = None
    for model in MODELS:
        for attempt in range(3):
            try:
                return model, call(model, prompt, key)
            except urllib.error.HTTPError as e:
                last = f"{model}: HTTP {e.code} {e.read()[:300]!r}"
                if e.code in (429, 500, 503):
                    time.sleep(20 * (attempt + 1)); continue
                break  # 400/401/404 などは次のモデルへ
            except (urllib.error.URLError, TimeoutError) as e:
                last = f"{model}: {e}"; break  # 時間切れは次のモデルへ
        print("fallback:", last, file=sys.stderr)
    sys.exit(f"Gemini API の呼び出しに失敗しました: {last}")


def parse(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    d = json.loads(text)
    picks = [p for p in d.get("picks", []) if isinstance(p, dict) and p.get("name")]
    if not 3 <= len(picks) <= 10:
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
    return str(d.get("summary", "")).strip(), [{k: p[k] for k in keys if p.get(k) not in (None, "")} for p in picks]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--context", help="今週の市場ニュース要約（テキストファイル）")
    ap.add_argument("--dry-run", action="store_true", help="書き込まずに表示だけ")
    a = ap.parse_args()
    today = datetime.datetime.now(JST).date().isoformat()
    previous = json.loads(OUT.read_text()) if OUT.exists() else None
    context = Path(a.context).read_text().strip() if a.context else ""
    model, text = ask(build_prompt(today, previous, context))
    summary, picks = parse(text)
    out = {"updatedAt": today, "model": model, "summary": summary, "picks": picks}
    s = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    if a.dry_run:
        print(s)
    else:
        OUT.write_text(s); print(f"updated {OUT} with {model}: {len(picks)} picks")


if __name__ == "__main__":
    main()
