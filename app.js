// 各AIは data/<id>.json を更新するだけ。ここに並べる順番でカード表示される。
const ADVISORS = [
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

// ゲージの長さ：そのリストで一番大きい配分を100%として比べる（差が見えやすいように）
const gaugeWidth = (p, max) => max > 0 ? Math.max(4, Math.round((Number(p.allocation) || 0) / max * 100)) : 0;
const maxAlloc = (picks) => Math.max(0, ...picks.map((p) => Number(p.allocation) || 0));
const riskDot = (p) => p.risk ? `<i class="risk ${esc(p.risk)}" title="リスク${esc(p.risk)}"></i>` : "";

function compactRowHTML(p, i, votes, color, max = 100) {
  const n = votes?.get(keyOf(p))?.size ?? 0;
  return `<li><div class="row">
    <span class="no">${i + 1}</span>
    <span class="title">
      <span class="name">${riskDot(p)}${esc(p.name)}</span>
      <span class="sub2">
        ${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}
        ${p.type ? `<span>${esc(p.type)}</span>` : ""}
        ${n >= 2 ? `<span class="match" title="${n}つのAIが推奨">×${n}</span>` : ""}
      </span>
    </span>
    ${p.allocation != null ? `<span class="alloc"><b>${esc(p.allocation)}<small>%</small></b></span>
      <span class="gauge"><i style="width:${gaugeWidth(p, max)}%;background:${color};color:${color}"></i></span>` : "<span></span>"}
  </div></li>`;
}

function advisorCard(a, data, votes, idx) {
  const picks = ranked(data?.picks);
  return `<article class="card${picks.length ? " tappable" : ""}" style="--c:${a.color}" data-idx="${idx}"
      ${picks.length ? `role="button" tabindex="0" aria-label="${esc(a.label)}のランキングを拡大"` : ""}>
    <div class="card-head"><h3>${esc(a.label)}</h3>
      <span class="date">${data?.updatedAt ? esc(data.updatedAt) : "未更新"}</span></div>
    ${data?.summary ? `<p class="summary">${esc(data.summary)}</p>` : ""}
    ${picks.length ? `<ol class="rank">${picks.map((p, i) => compactRowHTML(p, i, votes, a.color, maxAlloc(picks))).join("")}</ol>`
                   : `<p class="empty">まだ登録されていません</p>`}
  </article>`;
}

// タップで拡大表示するカード（画面の約80%）。詳細の説明はランキングの下にまとめて出す
function zoomHTML(a, data, votes) {
  const picks = ranked(data?.picks);
  return `<div class="zoom-card" style="--c:${a.color}" role="dialog" aria-modal="true" aria-label="${esc(a.label)}のランキング">
    <div class="card-head"><h3>${esc(a.label)}</h3><span class="sel">SELECTED</span>
      <span class="date">${data?.updatedAt ? esc(data.updatedAt) : "未更新"}</span>
      <button class="close" type="button" aria-label="閉じる">✕</button></div>
    <div class="zbody">
    <ol class="zrank">${picks.map((p, i) => {
      const n = votes?.get(keyOf(p))?.size ?? 0;
      const tags = [p.type, p.horizon].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      const alloc = gaugeWidth(p, maxAlloc(picks));
      return `<li>
        <div class="ztop">
          <span class="no">${i + 1}</span>
          <div class="zname"><b>${esc(p.name)}</b></div>
          ${p.allocation != null ? `<span class="zalloc"><span class="bar"><i style="width:${alloc}%;background:${a.color};color:${a.color}"></i></span>${esc(p.allocation)}<small>%</small></span>` : "<span></span>"}
        </div>
        <div class="ztags">
          ${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}
          ${p.risk ? `<span class="tag"><i class="risk ${esc(p.risk)}"></i>リスク${esc(p.risk)}</span>` : ""}
          ${tags}
          ${n >= 2 ? `<span class="match">${n}つのAIが推奨</span>` : ""}
        </div>
      </li>`;
    }).join("")}</ol>
    <div class="zdetails">
      <h4>詳細</h4>
      ${data?.summary ? `<p class="zsummary">${esc(data.summary)}</p>` : ""}
      ${picks.map((p, i) => {
        const meta = [p.type, p.horizon, p.risk && `リスク${p.risk}`].filter(Boolean).map(esc).join(" ・ ");
        return `<div class="zdetail">
          <div class="zd-head"><span class="no">${i + 1}</span><b>${esc(p.name)}</b>${p.ticker ? `<span class="ticker">${esc(p.ticker)}</span>` : ""}</div>
          ${p.thesis ? `<p>${esc(p.thesis)}</p>` : ""}
          ${meta ? `<div class="meta">${meta}</div>` : ""}
        </div>`;
      }).join("")}
    </div>
    </div>
  </div>`;
}

let lastResults = [], lastVotes = new Map(), lastDecision = null;
const zoom = document.getElementById("zoom");
function showZoom(html, originEl) {
  document.querySelectorAll(".selected").forEach((c) => c.classList.remove("selected"));
  originEl?.classList.add("selected");
  zoom.innerHTML = html;
  zoom.hidden = false;
  // 押したカード／パネルの位置から拡大して見えるように
  const zc = zoom.querySelector(".zoom-card"), r = originEl?.getBoundingClientRect(), z = zc.getBoundingClientRect();
  if (r) { zc.style.setProperty("--ox", `${r.left + r.width / 2 - z.left}px`); zc.style.setProperty("--oy", `${r.top + r.height / 2 - z.top}px`); }
  document.body.classList.add("noscroll");
  zoom.querySelector(".close").focus({ preventScroll: true });
}
function openZoom(idx) {
  const { a, data } = lastResults[idx];
  showZoom(zoomHTML(a, data, lastVotes), document.querySelector(`.card[data-idx="${idx}"]`));
}
function openZoomDecision() {
  const d = decisionView(lastDecision);
  if (!d?.picks?.length) return;
  showZoom(
    zoomHTML({ label: "FINAL DECISION", color: "#00e5e6" }, { updatedAt: d.decidedAt, summary: d.memo, picks: d.picks }, lastVotes),
    document.getElementById("decision").closest("section.panel"));
}
function closeZoom() {
  zoom.hidden = true; zoom.innerHTML = ""; document.body.classList.remove("noscroll");
  document.querySelectorAll(".selected").forEach((c) => c.classList.remove("selected"));
}
zoom.addEventListener("click", (e) => { if (e.target === zoom || e.target.closest(".close")) closeZoom(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !zoom.hidden) closeZoom(); });
document.getElementById("advisors").addEventListener("click", (e) => {
  const card = e.target.closest(".card.tappable"); if (card) openZoom(+card.dataset.idx);
});
document.getElementById("advisors").addEventListener("keydown", (e) => {
  const card = e.target.closest(".card.tappable");
  if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openZoom(+card.dataset.idx); }
});
const decisionPanel = document.getElementById("decision").closest("section.panel");
decisionPanel.addEventListener("click", () => openZoomDecision());
decisionPanel.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openZoomDecision(); }
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
    ${rows.map(([k, s]) => `<tr><td>${riskDot(names.get(k))}${esc(names.get(k).name)} <span class="ticker">${esc(names.get(k).ticker)}</span></td>
      <td class="chips">${[...s].map((a) => `<span style="--c:${a.color}">${esc(a.label)}</span>`).join("")}</td>
      <td><b>${s.size}</b>/${ADVISORS.length}</td></tr>`).join("")}</table>`;
}

function decisionHTML(d, votes) {
  if (!d?.picks?.length) return `<p class="empty">${mode === "stocks" ? "個別株の最終判断はまだありません" : "まだ決定していません"}</p>`;
  return `${d.decidedAt ? `<div class="date">決定日: ${esc(d.decidedAt)}</div>` : ""}
    <ol class="rank">${ranked(d.picks).map((p, i) => compactRowHTML(p, i, votes, "#00e5e6", maxAlloc(d.picks))).join("")}</ol>
    ${d.memo ? `<p class="memo">${esc(d.memo)}</p>` : ""}
    <p class="tap-hint">パネルをタップすると拡大表示します</p>`;
}

// 表示モード: "stocks" = 個別株ランキング（オルカン等の長期インデックスを除く）、"all" = ポートフォリオ全体
let mode = "stocks";
try { mode = localStorage.getItem("investra-mode") || "stocks"; } catch {}
const view = (d) => d && (mode === "stocks"
  ? { updatedAt: d.stocks?.length ? (d.stocksUpdatedAt || d.updatedAt) : null, summary: d.stocksSummary, picks: d.stocks }
  : d);
let lastRaw = [], lastFullVotes = new Map();
// 最終決定も個別株／全体で切り替える（個別株は decision.json の stocks / stocksMemo / stocksDecidedAt）
const decisionView = (d) => d && (mode === "stocks"
  ? (() => { const picks = d.stocksPicks || d.stocks;  // 個別株版の決定（stocksPicks。旧名 stocks も読む）
      return { decidedAt: picks?.length ? (d.stocksDecidedAt || d.decidedAt) : null, memo: d.stocksMemo, picks }; })()
  : d);

function paintDecision() {
  const d = decisionView(lastDecision);
  document.getElementById("decision").innerHTML = decisionHTML(d, lastVotes);
  const panel = document.getElementById("decision").closest("section.panel");
  if (d?.picks?.length) {
    panel.classList.add("tappable"); panel.setAttribute("role", "button"); panel.setAttribute("tabindex", "0");
    panel.setAttribute("aria-label", "最終的な投資先を拡大");
  } else {
    panel.classList.remove("tappable"); panel.removeAttribute("role"); panel.removeAttribute("tabindex");
  }
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem("investra-mode", m); } catch {}
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
}
document.querySelectorAll(".seg button").forEach((b) => b.onclick = () => { setMode(b.dataset.mode); paint(); });

// 読み込み済みのデータで画面を描き直す（モード切り替え時はこれだけ）
function paint() {
  const results = lastRaw.map(({ a, data }) => ({ a, data: view(data) }));
  const tally = collectVotes(results);
  lastResults = results; lastVotes = tally.votes;
  document.getElementById("advisors").innerHTML = results.map(({ a, data }, i) => advisorCard(a, data, tally.votes, i)).join("");
  paintDecision();
  document.getElementById("consensus").innerHTML = consensusHTML(tally) +
    `<div class="legend"><span><i class="risk 低"></i>リスク低</span><span><i class="risk 中"></i>中</span><span><i class="risk 高"></i>高</span><span><b class="match">×2</b> 他のAIと重複</span></div>`;
}

async function render() {
  lastRaw = await Promise.all(ADVISORS.map(async (a) => ({ a, data: await load(`data/${a.id}.json`) })));
  lastFullVotes = collectVotes(lastRaw).votes;
  lastDecision = await load("data/decision.json");
  setMode(mode);
  paint();
}

// 右上の更新ボタン：ページを再読み込みせずに最新のJSONを取り直す
const btn = document.getElementById("refresh");
// 公開中のページの版（index.html の app.js?v=…）が今のものと違えば、新しい版に読み替える。
// ホーム画面に追加したアプリは自分では再読み込みしないので、これで最新版に追いつかせる。
const currentVersion = (document.querySelector('script[src*="app.js"]')?.getAttribute("src").match(/v=(\w+)/) || [])[1];
async function updateAppIfNewer() {
  try {
    const res = await fetch(`index.html?check=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const latest = ((await res.text()).match(/app\.js\?v=(\w+)/) || [])[1];
    if (latest && currentVersion && latest !== currentVersion) {
      location.replace(`${location.pathname}?v=${latest}`);  // URLを変えてキャッシュを使わせない
      return true;
    }
  } catch {}
  return false;
}

btn.onclick = async () => {
  if (btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  if (await updateAppIfNewer()) return;
  await Promise.all([render(), new Promise((r) => setTimeout(r, 700))]);
  btn.classList.remove("busy");
};
// アプリを開き直したとき（ホーム画面から戻ったとき）も確認する
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") updateAppIfNewer(); });
updateAppIfNewer();

render();

// 上部バーは position: fixed。その高さぶん本文を下げる
const headerEl = document.querySelector("header");
const setHeaderH = () => document.documentElement.style.setProperty("--hh", `${headerEl.offsetHeight + 10}px`);
setHeaderH();
if ("ResizeObserver" in window) new ResizeObserver(setHeaderH).observe(headerEl); else addEventListener("resize", setHeaderH);
