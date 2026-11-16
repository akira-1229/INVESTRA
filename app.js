// 各AIは data/<id>.json を更新するだけ。ここに並べる順番でカード表示される。
const ADVISORS = [
  { id: "chatgpt", label: "ChatGPT", color: "#10a37f" },
  { id: "claude",  label: "Claude",  color: "#d97757" },
  { id: "gemini",  label: "Gemini",  color: "#4285f4" },
  { id: "muse",    label: "Muse",    color: "#9b59d0" },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const keyOf = (p) => (p.ticker || p.name || "").trim().toUpperCase();

async function load(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// 配分の大きい順（同率なら元の順）にランキング
const ranked = (picks = []) =>
  picks.map((p, i) => ({ p, i })).sort((a, b) => (b.p.allocation ?? -1) - (a.p.allocation ?? -1) || a.i - b.i).map((x) => x.p);

function rowHTML(p, i, votes, color) {
  const n = votes?.get(keyOf(p))?.size ?? 0;
  const meta = [p.type, p.horizon, p.risk && `リスク${p.risk}`].filter(Boolean).map(esc).join(" ・ ");
  return `<li><details>
    <summary>
      <span class="no">${i + 1}</span>
      <span class="title">
        <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="sub2">
          ${p.risk ? `<i class="risk ${esc(p.risk)}" title="リスク${esc(p.risk)}"></i>` : ""}
          ${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}
          ${p.type ? `<span>${esc(p.type)}</span>` : ""}
          ${n >= 2 ? `<span class="match" title="${n}つのAIが推奨">×${n}</span>` : ""}
        </span>
      </span>
      ${p.allocation != null ? `<span class="alloc"><b>${esc(p.allocation)}%</b>
        <div class="bar"><i style="width:${Math.min(100, Number(p.allocation) || 0)}%;background:${color}"></i></div></span>` : "<span></span>"}
    </summary>
    <div class="detail">${p.thesis ? `<p>${esc(p.thesis)}</p>` : ""}<div class="meta">${meta}</div></div>
  </details></li>`;
}

function advisorCard(a, data, votes) {
  const picks = ranked(data?.picks);
  return `<article class="card" style="--c:${a.color}">
    <div class="card-head"><h3>${esc(a.label)}</h3>
      <span class="date">${data?.updatedAt ? esc(data.updatedAt) : "未更新"}</span></div>
    ${data?.summary ? `<p class="summary" title="クリックで全文">${esc(data.summary)}</p>` : ""}
    ${picks.length ? `<ol class="rank">${picks.map((p, i) => rowHTML(p, i, votes, a.color)).join("")}</ol>`
                   : `<p class="empty">まだ登録されていません</p>`}
  </article>`;
}

function collectVotes(results) {
  const votes = new Map(), names = new Map();
  for (const { a, data } of results) for (const p of data?.picks ?? []) {
    const k = keyOf(p); if (!k) continue;
    if (!votes.has(k)) { votes.set(k, new Set()); names.set(k, p); }
    votes.get(k).add(a);
  }
  return { votes, names };
}

function consensusHTML({ votes, names }) {
  const rows = [...votes].filter(([, s]) => s.size >= 2).sort((x, y) => y[1].size - x[1].size);
  if (!rows.length) return `<p class="empty">まだ重なっている銘柄はありません</p>`;
  return `<table><tr><th>銘柄</th><th>推したAI</th><th>数</th></tr>
    ${rows.map(([k, s]) => `<tr><td>${esc(names.get(k).name)} <span class="ticker">${esc(names.get(k).ticker)}</span></td>
      <td class="chips">${[...s].map((a) => `<span style="--c:${a.color}">${esc(a.label)}</span>`).join("")}</td>
      <td><b>${s.size}</b>/${ADVISORS.length}</td></tr>`).join("")}</table>`;
}

function decisionHTML(d, votes) {
  if (!d?.picks?.length) return `<p class="empty">まだ決定していません</p>`;
  return `${d.decidedAt ? `<div class="date">決定日: ${esc(d.decidedAt)}</div>` : ""}
    ${d.memo ? `<p class="summary open">${esc(d.memo)}</p>` : ""}
    <ol class="rank">${ranked(d.picks).map((p, i) => rowHTML(p, i, votes, "var(--accent)")).join("")}</ol>`;
}

(async () => {
  const results = await Promise.all(ADVISORS.map(async (a) => ({ a, data: await load(`data/${a.id}.json`) })));
  const tally = collectVotes(results);
  document.getElementById("advisors").innerHTML = results.map(({ a, data }) => advisorCard(a, data, tally.votes)).join("");
  document.getElementById("consensus").innerHTML = consensusHTML(tally) +
    `<div class="legend"><span><i class="risk 低"></i>リスク低</span><span><i class="risk 中"></i>中</span><span><i class="risk 高"></i>高</span><span><b class="match">×2</b> 他のAIと重複</span></div>`;
  document.getElementById("decision").innerHTML = decisionHTML(await load("data/decision.json"), tally.votes);
  document.querySelectorAll(".card .summary").forEach((el) => el.onclick = () => el.classList.toggle("open"));
})();
