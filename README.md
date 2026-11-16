# INVESTRA

自分専用の投資判断ページ。Claude・Gemini・Muse・Siri が定期的にそれぞれのおすすめ投資先を並べ、それを見比べて最終的な投資先を自分で決める。

## 表示の仕方

ビルド不要の静的サイトです。JSON を `fetch` するので、ファイルを直接開くのではなくサーバー経由で見てください。

```sh
python3 -m http.server 8000   # → http://localhost:8000
```

GitHub Pages（Settings → Pages → main ブランチのルート）でも公開できます。

CSS/JS を変えたら `index.html` の `style.css?v=…` と `app.js?v=…` の数字も更新する（スマホに古いファイルが残らないように）。
ホーム画面に追加したアプリは、更新ボタンを押したときと開き直したときにこの数字を確認し、新しければ自動で読み替える。

## データの置き場所

| ファイル | 書く人 |
| --- | --- |
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

- 個別株ランキングは同じファイルに `stocks`（形式は `picks` と同じ。個別企業の株だけで、配分は個別株枠の中での比率）と `stocksSummary` を足す。画面右上の「個別株／全体」で切り替える。
- `name` 以外は省略可。`short` を書くとカードにはそちらが表示され、正式名はタップで開く詳細に出る。
- `ticker` が同じ銘柄は「重なり」欄で集計されるので、できるだけ揃える（米国株はティッカー、日本株は証券コード）。
- `decision.json` は `updatedAt` の代わりに `decidedAt`、`summary` の代わりに `memo` を使う。個別株の最終判断は同じファイルに `stocksPicks`・`stocksMemo`・`stocksDecidedAt` を書く（「個別株」タブで表示）。

## 自動更新（毎週土曜の朝）

1. **Claude**（クラウドセッション、8:47 JST）
   - `data/claude.json` を自分で調べて見直す。
   - `data/news.md` に今週の市場ニュースを事実だけまとめる（Gemini に参考として渡す）。
   - 上の2つを push したあと、Gemini の GitHub Actions を起動する。
2. **Gemini**：Actions「Update Gemini Recommendations」
   - `python3 scripts/update_picks.py gemini --context data/news.md`。キーは GitHub の Secrets `GEMINI_API_KEY`。

Claude が起動しなかった週も、Gemini は 11:07 に自動で動く（その日すでに更新済みなら何もしない）。
Actions タブから手動実行もできる。結果はデフォルトブランチと `main` の両方に書き込む。

## 銘柄ニュース（⚠表示）の自動更新

- Claude の定期タスクが 1日3回（7:13 / 12:13 / 19:13 JST）、アプリに出ている個別株について直近7日の重大ニュースを Web 検索で調べ、
  `data/news.json` を書き換えて push する（承認不要）。
- `scripts/update_news.py`（Gemini＋Google検索）も残してあるが、Gemini の無料枠では検索が使えないため自動実行はしていない。

## AIに渡す依頼文の例

> 以下のJSON形式で、(1) ポートフォリオ全体のおすすめ投資先を `picks` に5〜7件、(2) オルカンやS&P500などの長期インデックスとは別枠で買う個別株のランキングを `stocks` に5〜7件（個別企業の株だけ。投資信託・ETFは入れない）出してください。`risk` は「低・中・高」のどれか、`allocation` はそれぞれ合計100になる配分(%)。`short` には短い表示名を入れてください。（上の形式を貼り、`stocksSummary` と `stocks` の欄も足す）

---

AIの推奨は情報であり、投資助言ではありません。最終判断は自己責任で。
