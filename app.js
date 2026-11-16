// 各AIは data/<id>.json を更新するだけ。ここに並べる順番でカード表示される。
const ADVISORS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude",  label: "Claude"  },
  { id: "gemini",  label: "Gemini"  },
  { id: "muse",    label: "Muse"    },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function load(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// 配分の大きい順に並べ替える（配分なしは最後）
const sorted = (picks) => [...(picks ?? [])].sort(
  (a, b) => (b.allocation ?? -1) - (a.allocation ?? -1));

// 1銘柄＝ランキングの1行。クリックで理由（thesis）を開く。
function pickRow(p, i) {
  const tags = [
    p.type && `<span class="tag">${esc(p.type)}</span>`,
    p.horizon && `<span class="tag">${esc(p.horizon)}</span>`,
  ].filter(Boolean).join("");
  const detail = (p.thesis || tags) ? `<div class="detail">
      ${p.thesis ? `<p class="thesis">${esc(p.thesis)}</p>` : ""}
      ${tags ? `<div class="tags">${tags}</div>` : ""}
    </div>` : "";
  const head = `<span class="rank r${i + 1}">${i + 1}</span>
    <span class="pname">${esc(p.name)}${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}</span>
    ${p.allocation != null ? `<span class="bar"><i style="width:${esc(p.allocation)}%"></i></span><span class="alloc">${esc(p.allocation)}%</span>` : ""}
    ${p.risk ? `<span class="risk risk-${esc(p.risk)}">${esc(p.risk)}</span>` : ""}`;
  return detail
    ? `<details class="pick"><summary>${head}</summary>${detail}</details>`
    : `<div class="pick"><summary>${head}</summary></div>`;
}

function pickList(picks) {
  return sorted(picks).map(pickRow).join("");
}

function advisorCard(a, data) {
  const picks = data?.picks ?? [];
  return `<article class="card">
    <div class="card-head"><h3>${esc(a.label)}</h3>
      <div class="meta">${data?.updatedAt ? esc(data.updatedAt) : "未更新"}</div></div>
    ${data?.summary ? `<div class="summary" title="${esc(data.summary)}">${esc(data.summary)}</div>` : ""}
    ${picks.length ? pickList(picks) : `<p class="empty">まだおすすめが登録されていません</p>`}
  </article>`;
}

function consensusHTML(results) {
  const map = new Map();
  for (const { a, data } of results) {
    for (const p of data?.picks ?? []) {
      const key = (p.ticker || p.name || "").trim().toUpperCase();
      if (!key) continue;
      const e = map.get(key) ?? { name: p.name, ticker: p.ticker, by: new Set(), allocs: [] };
      e.by.add(a.label);
      if (p.allocation != null) e.allocs.push(p.allocation);
      map.set(key, e);
    }
  }
  const rows = [...map.values()].filter((e) => e.by.size >= 2)
    .sort((x, y) => y.by.size - x.by.size);
  if (!rows.length) return `<p class="empty">まだ重なっている銘柄はありません</p>`;
  const avg = (e) => e.allocs.length ? Math.round(e.allocs.reduce((s, v) => s + v, 0) / e.allocs.length) : "–";
  return `<div class="tablewrap"><table>
    <tr><th>銘柄</th><th>推したAI</th><th>数</th><th>平均配分</th></tr>
    ${rows.map((e) => `<tr><td>${esc(e.name)}${e.ticker ? `<span class="ticker">${esc(e.ticker)}</span>` : ""}</td>
      <td class="dots">${[...e.by].map((b) => `<span>${esc(b)}</span>`).join("")}</td>
      <td>${e.by.size}/${ADVISORS.length}</td><td>${avg(e)}%</td></tr>`).join("")}
  </table></div>`;
}

function decisionHTML(d) {
  if (!d?.picks?.length) return `<p class="empty">まだ決定していません（<code>data/decision.json</code> を編集）</p>`;
  return `<article class="card">
    <div class="card-head"><h3>自分の結論</h3>
      <div class="meta">${d.decidedAt ? esc(d.decidedAt) : ""}</div></div>
    ${d.memo ? `<div class="summary" title="${esc(d.memo)}">${esc(d.memo)}</div>` : ""}
    ${pickList(d.picks)}
  </article>`;
}

(async () => {
  const results = await Promise.all(ADVISORS.map(async (a) => ({ a, data: await load(`data/${a.id}.json`) })));
  document.getElementById("advisors").innerHTML = results.map(({ a, data }) => advisorCard(a, data)).join("");
  document.getElementById("consensus").innerHTML = consensusHTML(results);
  document.getElementById("decision").innerHTML = decisionHTML(await load("data/decision.json"));
})();
