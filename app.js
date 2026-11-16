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

function pickHTML(p) {
  const tags = [
    p.type && `<span class="tag">${esc(p.type)}</span>`,
    p.horizon && `<span class="tag">${esc(p.horizon)}</span>`,
    p.risk && `<span class="tag risk-${esc(p.risk)}">リスク ${esc(p.risk)}</span>`,
    p.allocation != null && `<span class="tag">配分 ${esc(p.allocation)}%</span>`,
  ].filter(Boolean).join("");
  return `<div class="pick">
    <div><span class="name">${esc(p.name)}</span>${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}</div>
    ${p.thesis ? `<div class="thesis">${esc(p.thesis)}</div>` : ""}
    <div class="tags">${tags}</div>
  </div>`;
}

function advisorCard(a, data) {
  const picks = data?.picks ?? [];
  return `<article class="card">
    <h3>${esc(a.label)}</h3>
    <div class="meta">${data?.updatedAt ? `更新: ${esc(data.updatedAt)}` : "未更新"}</div>
    ${data?.summary ? `<div class="summary">${esc(data.summary)}</div>` : ""}
    ${picks.length ? picks.map(pickHTML).join("") : `<p class="empty">まだおすすめが登録されていません</p>`}
  </article>`;
}

function consensusHTML(results) {
  const map = new Map();
  for (const { a, data } of results) {
    for (const p of data?.picks ?? []) {
      const key = (p.ticker || p.name || "").trim().toUpperCase();
      if (!key) continue;
      const e = map.get(key) ?? { name: p.name, ticker: p.ticker, by: new Set() };
      e.by.add(a.label);
      map.set(key, e);
    }
  }
  const rows = [...map.values()].filter((e) => e.by.size >= 2).sort((x, y) => y.by.size - x.by.size);
  if (!rows.length) return `<p class="empty">まだ重なっている銘柄はありません</p>`;
  return `<div class="tablewrap"><table>
    <tr><th>銘柄</th><th>ティッカー</th><th>推したAI</th><th>数</th></tr>
    ${rows.map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(e.ticker)}</td>
      <td class="dots">${[...e.by].map((b) => `<span>${esc(b)}</span>`).join("")}</td>
      <td>${e.by.size}/${ADVISORS.length}</td></tr>`).join("")}
  </table></div>`;
}

function decisionHTML(d) {
  if (!d?.picks?.length) return `<p class="empty">まだ決定していません</p>`;
  return `<article class="card">
    <div class="meta">${d.decidedAt ? `決定日: ${esc(d.decidedAt)}` : ""}</div>
    ${d.memo ? `<div class="summary">${esc(d.memo)}</div>` : ""}
    ${d.picks.map(pickHTML).join("")}
  </article>`;
}

(async () => {
  const results = await Promise.all(ADVISORS.map(async (a) => ({ a, data: await load(`data/${a.id}.json`) })));
  document.getElementById("advisors").innerHTML = results.map(({ a, data }) => advisorCard(a, data)).join("");
  document.getElementById("consensus").innerHTML = consensusHTML(results);
  document.getElementById("decision").innerHTML = decisionHTML(await load("data/decision.json"));
})();
