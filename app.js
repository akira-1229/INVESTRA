// 各AIは data/<id>.json を更新するだけ。ここに並べる順番でカード表示される。
const ADVISORS = [
  { id: "chatgpt", label: "ChatGPT", color: "#19f0a8" },
  { id: "claude",  label: "Claude",  color: "#ff8a5c" },
  { id: "gemini",  label: "Gemini",  color: "#4da3ff" },
  { id: "muse",    label: "Muse",    color: "#c77dff" },
  { id: "siri",    label: "Siri",    color: "#ff5fa2" },
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
        <span class="name" title="${esc(p.name)}">${esc(p.short || p.name)}</span>
        <span class="sub2">
          ${p.risk ? `<i class="risk ${esc(p.risk)}" title="リスク${esc(p.risk)}"></i>` : ""}
          ${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}
          ${p.type ? `<span>${esc(p.type)}</span>` : ""}
          ${n >= 2 ? `<span class="match" title="${n}つのAIが推奨">×${n}</span>` : ""}
        </span>
      </span>
      ${p.allocation != null ? `<span class="alloc"><b>${esc(p.allocation)}%</b>
        <div class="bar"><i style="width:${Math.min(100, Number(p.allocation) || 0)}%;background:${color};color:${color}"></i></div></span>` : "<span></span>"}
    </summary>
    <div class="detail">${p.short ? `<p class="full">${esc(p.name)}</p>` : ""}${p.thesis ? `<p>${esc(p.thesis)}</p>` : ""}<div class="meta">${meta}</div></div>
  </details></li>`;
}

function compactRowHTML(p, i, votes, color) {
  const n = votes?.get(keyOf(p))?.size ?? 0;
  return `<li><div class="row">
    <span class="no">${i + 1}</span>
    <span class="title">
      <span class="name" title="${esc(p.name)}">${esc(p.short || p.name)}</span>
      <span class="sub2">
        ${p.risk ? `<i class="risk ${esc(p.risk)}" title="リスク${esc(p.risk)}"></i>` : ""}
        ${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}
        ${p.type ? `<span>${esc(p.type)}</span>` : ""}
        ${n >= 2 ? `<span class="match" title="${n}つのAIが推奨">×${n}</span>` : ""}
      </span>
    </span>
    ${p.allocation != null ? `<span class="alloc"><b>${esc(p.allocation)}%</b>
      <div class="bar"><i style="width:${Math.min(100, Number(p.allocation) || 0)}%;background:${color};color:${color}"></i></div></span>` : "<span></span>"}
  </div></li>`;
}

function advisorCard(a, data, votes, idx) {
  const picks = ranked(data?.picks);
  return `<article class="card${picks.length ? " tappable" : ""}" style="--c:${a.color}" data-idx="${idx}"
      ${picks.length ? `role="button" tabindex="0" aria-label="${esc(a.label)}のランキングを拡大"` : ""}>
    <div class="card-head"><h3>${esc(a.label)}</h3>
      <span class="date">${data?.updatedAt ? esc(data.updatedAt) : "未更新"}</span></div>
    ${data?.summary ? `<p class="summary">${esc(data.summary)}</p>` : ""}
    ${picks.length ? `<ol class="rank">${picks.map((p, i) => compactRowHTML(p, i, votes, a.color)).join("")}</ol>`
                   : `<p class="empty">まだ登録されていません</p>`}
  </article>`;
}

// タップで拡大表示するカード
function zoomHTML(a, data, votes) {
  const picks = ranked(data?.picks);
  return `<div class="zoom-card" style="--c:${a.color}" role="dialog" aria-modal="true" aria-label="${esc(a.label)}のおすすめ">
    <div class="card-head"><h3>${esc(a.label)}</h3>
      <span class="date">${data?.updatedAt ? `更新 ${esc(data.updatedAt)}` : "未更新"}</span>
      <button class="close" type="button" aria-label="閉じる">✕</button></div>
    ${data?.summary ? `<p class="zsummary">${esc(data.summary)}</p>` : ""}
    <ol class="zrank">${picks.map((p, i) => {
      const n = votes?.get(keyOf(p))?.size ?? 0;
      const tags = [p.type, p.horizon].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      return `<li>
        <div class="ztop">
          <span class="no">${i + 1}</span>
          <div class="zname"><b>${esc(p.short || p.name)}</b>${p.short && p.short !== p.name ? `<small>${esc(p.name)}</small>` : ""}</div>
          ${p.allocation != null ? `<span class="zalloc">${esc(p.allocation)}<small>%</small></span>` : ""}
        </div>
        ${p.allocation != null ? `<div class="bar"><i style="width:${Math.min(100, Number(p.allocation) || 0)}%;background:${a.color};color:${a.color}"></i></div>` : ""}
        <div class="ztags">
          ${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}
          ${p.risk ? `<span class="tag"><i class="risk ${esc(p.risk)}"></i> リスク${esc(p.risk)}</span>` : ""}
          ${tags}
          ${n >= 2 ? `<span class="match">${n}つのAIが推奨</span>` : ""}
        </div>
        ${p.thesis ? `<p class="zthesis">${esc(p.thesis)}</p>` : ""}
      </li>`;
    }).join("")}</ol>
  </div>`;
}

let lastResults = [], lastVotes = new Map();
const zoom = document.getElementById("zoom");
function openZoom(idx) {
  const { a, data } = lastResults[idx];
  zoom.innerHTML = zoomHTML(a, data, lastVotes);
  zoom.hidden = false;
  document.body.classList.add("noscroll");
  zoom.querySelector(".close").focus();
}
function closeZoom() { zoom.hidden = true; zoom.innerHTML = ""; document.body.classList.remove("noscroll"); }
zoom.addEventListener("click", (e) => { if (e.target === zoom || e.target.closest(".close")) closeZoom(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !zoom.hidden) closeZoom(); });
document.getElementById("advisors").addEventListener("click", (e) => {
  const card = e.target.closest(".card.tappable"); if (card) openZoom(+card.dataset.idx);
});
document.getElementById("advisors").addEventListener("keydown", (e) => {
  const card = e.target.closest(".card.tappable");
  if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openZoom(+card.dataset.idx); }
});

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
    <ol class="rank">${ranked(d.picks).map((p, i) => rowHTML(p, i, votes, "#00e5e6")).join("")}</ol>`;
}

async function render() {
  const results = await Promise.all(ADVISORS.map(async (a) => ({ a, data: await load(`data/${a.id}.json`) })));
  const tally = collectVotes(results);
  lastResults = results; lastVotes = tally.votes;
  document.getElementById("advisors").innerHTML = results.map(({ a, data }, i) => advisorCard(a, data, tally.votes, i)).join("");
  document.getElementById("consensus").innerHTML = consensusHTML(tally) +
    `<div class="legend"><span><i class="risk 低"></i>リスク低</span><span><i class="risk 中"></i>中</span><span><i class="risk 高"></i>高</span><span><b class="match">×2</b> 他のAIと重複</span></div>`;
  document.getElementById("decision").innerHTML = decisionHTML(await load("data/decision.json"), tally.votes);
}

// 右上の更新ボタン：ページを再読み込みせずに最新のJSONを取り直す
const btn = document.getElementById("refresh");
btn.onclick = async () => {
  if (btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  await Promise.all([render(), new Promise((r) => setTimeout(r, 700))]);
  btn.classList.remove("busy");
};

render();
