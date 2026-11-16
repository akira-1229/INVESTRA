#!/usr/bin/env python3
"""アプリに出ている個別株の「重大ニュース」を Gemini（Google検索つき）で調べて data/news.json を更新する。

使い方（GitHub Actions から）:
  GEMINI_API_KEY=... python3 scripts/update_news.py [--days 7] [--dry-run]

- 対象: data/{claude,gemini,muse,siri,decision}.json の個別企業（投資信託・ETF・債券・金は除く）
- Google検索で裏付けの取れたニュースだけを採用する。見つからなければ空にする。
- 失敗したら data/news.json は変更しない。
"""
import argparse, datetime, json, os, re, sys, time, urllib.error, urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
OUT = DATA / "news.json"
SOURCES = ["claude", "gemini", "muse", "siri", "decision"]
LISTS = ["stocks", "stocksPicks", "picks"]
FUND_WORDS = ("投資信託", "ETF", "インデックス", "債券", "国債", "REIT", "上場投信", "ファンド", "ゴールド", "上場信託")
MODELS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"]
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
JST = datetime.timezone(datetime.timedelta(hours=9))


def companies():
    """ticker（大文字）→ 正式名。ticker が無いもの・ファンド類は除く"""
    out = {}
    for src in SOURCES:
        f = DATA / f"{src}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text())
        for key in LISTS:
            for p in d.get(key) or []:
                name, ticker, typ = str(p.get("name", "")), str(p.get("ticker", "")).strip(), str(p.get("type", ""))
                if not ticker or not name:
                    continue
                if any(w in typ for w in FUND_WORDS) or any(w in name for w in FUND_WORDS):
                    continue
                if not re.fullmatch(r"[A-Z.]{1,6}|\d{4}", ticker.upper()):
                    continue  # 「オルカン」などの通称は企業ではない
                out.setdefault(ticker.upper(), name)
    return out


def build_prompt(comps, today, days):
    lines = "\n".join(f"- {name}（{t}）" for t, name in comps.items())
    return f"""今日は {today}（日本時間）です。Google検索で最新のニュースを確認し、次の企業それぞれについて、
直近{days}日以内に報じられた「株価に大きく影響しうる重大ニュース」があるかを調べてください。

対象企業:
{lines}

重大ニュースの例: 経営トップの辞任・交代、不祥事・スキャンダル、不正会計、大規模リコール、情報漏えい、
訴訟・制裁金・規制当局の処分、業績見通しの大幅な下方修正・決算ショック、大型買収・事業売却、工場事故・生産停止。
通常の決算発表、株価の値動きそのもの、アナリストの目標株価変更、噂レベルの話は含めない。

ルール:
- 検索で信頼できる報道機関の記事が確認できたものだけを書く。確認できなければその企業は出力しない。
- 1社につき最も重要な1件だけ。
- headline は日本語で30文字以内、事実だけを簡潔に。
- date は報道日（YYYY-MM-DD）。source は報道機関名。
- key は上のカッコ内のコードをそのまま使う。

出力は次のJSONだけにしてください（説明文やコードブロックは不要）。該当がなければ {{"alerts": []}}。
{{"alerts": [{{"key": "コード", "name": "企業名", "headline": "見出し", "date": "YYYY-MM-DD", "source": "報道機関"}}]}}"""


def call(model, prompt, key):
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2},
    }).encode()
    req = urllib.request.Request(URL.format(model=model), body,
                                 {"x-goog-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=240) as r:
        d = json.load(r)
    parts = d["candidates"][0]["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts).strip()
    grounded = bool(d["candidates"][0].get("groundingMetadata", {}).get("groundingChunks"))
    return text, grounded


def parse(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"JSONが見つからない: {text[:200]!r}")
    return json.loads(m.group(0)).get("alerts") or []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY がありません")
    comps = companies()
    now = datetime.datetime.now(JST)
    today = now.date()
    print(f"対象 {len(comps)} 社: {', '.join(comps)}")
    prompt = build_prompt(comps, today.isoformat(), a.days)

    alerts, last = None, None
    for model in MODELS:
        for attempt in range(2):
            try:
                text, grounded = call(model, prompt, key)
                if not grounded:
                    raise ValueError("Google検索の裏付けがない回答")
                alerts = parse(text)
                break
            except urllib.error.HTTPError as e:
                last = f"{model}: HTTP {e.code} {e.read()[:300]!r}"
                if e.code in (429, 500, 503):
                    time.sleep(20 * (attempt + 1)); continue
                break
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError) as e:
                last = f"{model}: {e}"; break
        if alerts is not None:
            print(f"model: {model}")
            break
        print("fallback:", last, file=sys.stderr)
    if alerts is None:
        sys.exit(f"ニュースの取得に失敗しました（news.json は変更しません）: {last}")

    oldest = today - datetime.timedelta(days=a.days + 2)
    clean, seen = [], set()
    for x in alerts:
        if not isinstance(x, dict):
            continue
        k = str(x.get("key", "")).strip().upper()
        head = str(x.get("headline", "")).strip()
        if k not in comps or k in seen or not head:
            continue
        try:
            d = datetime.date.fromisoformat(str(x.get("date", ""))[:10])
        except ValueError:
            continue
        if not (oldest <= d <= today):
            continue  # 古い・未来の日付は捨てる
        seen.add(k)
        clean.append({"key": k, "name": comps[k], "headline": head[:40], "date": d.isoformat(),
                      "source": str(x.get("source", "")).strip()[:30]})
    clean.sort(key=lambda x: x["date"], reverse=True)
    out = {"updatedAt": now.strftime("%Y-%m-%d %H:%M"), "alerts": clean}
    s = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    print(s)
    if not a.dry_run:
        OUT.write_text(s)


if __name__ == "__main__":
    main()
