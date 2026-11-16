# INVESTRA

自分専用の投資判断ページ。ChatGPT・Claude・Gemini・Muse・Siri が定期的にそれぞれのおすすめ投資先を並べ、それを見比べて最終的な投資先を自分で決める。

## 表示の仕方

ビルド不要の静的サイトです。JSON を `fetch` するので、ファイルを直接開くのではなくサーバー経由で見てください。

```sh
python3 -m http.server 8000   # → http://localhost:8000
```

GitHub Pages（Settings → Pages → main ブランチのルート）でも公開できます。

## データの置き場所

| ファイル | 書く人 |
| --- | --- |
| `data/chatgpt.json` | ChatGPT |
| `data/claude.json` | Claude |
| `data/gemini.json` | Gemini |
| `data/muse.json` | Muse |
| `data/siri.json` | Siri |
| `data/decision.json` | 自分（最終判断） |

各AIは自分のファイルだけを上書きします。ほかのAIのファイルには触れません。

## JSON の形式

```json
{
  "updatedAt": "2026-11-16",
  "summary": "全体方針をひとこと",
  "picks": [
    {
      "name": "銘柄名（正式名）",
      "short": "短い表示名（例: オルカン）",
      "ticker": "MSFT",
      "type": "米国株",
      "horizon": "中長期（3〜5年）",
      "risk": "低 | 中 | 高",
      "allocation": 10,
      "thesis": "推す理由"
    }
  ]
}
```

- `name` 以外は省略可。`short` を書くとカードにはそちらが表示され、正式名はタップで開く詳細に出る。
- `ticker` が同じ銘柄は「重なり」欄で集計されるので、できるだけ揃える（米国株はティッカー、日本株は証券コード）。
- `decision.json` は `updatedAt` の代わりに `decidedAt`、`summary` の代わりに `memo` を使う。

## 自動更新（毎週土曜の朝）

1. **Claude**（クラウドセッション、8:47 JST）
   - `data/claude.json` を自分で調べて見直す。
   - `data/news.md` に今週の市場ニュースを事実だけまとめる（Gemini・ChatGPT に参考として渡す）。
   - 上の2つを push したあと、下の2つの GitHub Actions を起動する。
2. **Gemini**：Actions「Update Gemini Recommendations」
   - `python3 scripts/update_picks.py gemini --context data/news.md`。キーは GitHub の Secrets `GEMINI_API_KEY`。
3. **ChatGPT**：Actions「Update ChatGPT picks」
   - OpenAI API（有料・前払い）。GitHub の Settings → Secrets and variables → Actions に `OPENAI_API_KEY` を登録すると動く。未登録の間は何もしない。
   - （GitHub Models の無料枠は 2026-07-30 に終了したため使えない）

Claude が起動しなかった週も、Gemini は 11:07、ChatGPT は 11:13 に自動で動く（その日すでに更新済みなら何もしない）。
どちらも Actions タブから手動実行できる。結果はデフォルトブランチと `main` の両方に書き込む。

## AIに渡す依頼文の例

> 以下のJSON形式で、今のおすすめ投資先を5〜6件出してください。`risk` は「低・中・高」のどれか、`allocation` は合計100になる配分(%)。（上の形式を貼る）

---

AIの推奨は情報であり、投資助言ではありません。最終判断は自己責任で。
