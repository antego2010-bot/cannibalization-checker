(() => {
"use strict";
const PAGE_LIB = 50, PAGE_KW = 20;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const fmt = (n) => n == null ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let DEMO = false;
try { DEMO = localStorage.getItem("ccDemo") === "1"; } catch (e) {}
const SENS = new Set(["Clicks (3 mo)", "Impressions (3 mo)", "Total clicks (3 mo)", "Total impressions (3 mo)", "Sessions (12 mo)"]);
const MASK = "•••";
const fmtS = (n) => DEMO ? MASK : fmt(n);
const fv = (v) => typeof v === "string" ? esc(v) : fmt(v);
const maskText = (t) => DEMO ? String(t ?? "").replace(/\d[\d,.]*\s*[kKmM]?\s*(clicks?|impressions?|impr\b|sessions?)/gi, (m, w) => MASK + " " + w) : String(t ?? "");
const short = (u) => {
  const s = String(u || "");
  try { const x = new URL(s); if (x.hostname.replace(/^www\./, "") === siteDomain()) return (x.pathname + x.search) || "/"; return x.hostname.replace(/^www\./, "") + x.pathname; } catch (e) { return s || "/"; }
};
const norm = (u) => String(u || "").trim().replace(/\/+$/, "");
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "")) ? String(u) : "";
const link = (u, label) => safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label ?? short(u))}</a>` : esc(label ?? u ?? "");
const linkify = (text) => esc(maskText(text)).replace(/https?:\/\/[^\s,()<>"']+/g, m => { const t = m.match(/[.;:!?]+$/); const u = t ? m.slice(0, -t[0].length) : m; return `<a href="${u}" target="_blank" rel="noopener">${esc(short(u.replace(/&amp;/g, "&")))}</a>${t ? t[0] : ""}`; });
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const docId = (k) => (String(k).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x") + "-" + hashStr(String(k).toLowerCase());

// ---------- settings (kept in this browser only) ----------
const SKEY = "cc:settings";
function loadSettings() {
  let s = {};
  try { s = JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY) || "{}"); } catch (e) {}
  return { moz: "", claude: "", model: "", domain: "", brand: "", exclude: "", sections: "", size: 1000, mozRows: 1000, volumeLimit: 200, gscSite: "", ga4Property: "", ga4Skip: false, mozOnly: false, remember: false, ...s, mozOnly: true };
}
let CFG = loadSettings();
function saveSettings() {
  // Keys only persist across visits if the user ticks "remember"; site settings always persist.
  const data = JSON.stringify(CFG);
  const site = JSON.stringify({ ...CFG, moz: "", claude: "" });
  try {
    if (CFG.remember) { localStorage.setItem(SKEY, data); sessionStorage.removeItem(SKEY); }
    else { sessionStorage.setItem(SKEY, data); localStorage.setItem(SKEY, site); }
  } catch (e) {}
}
const siteDomain = () => String(CFG.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const brandName = () => (CFG.brand || "").split(",")[0].trim() || (siteDomain() ? siteDomain().split(".")[0].replace(/^./, c => c.toUpperCase()) : "Your site");
const listOf = (s) => String(s || "").split(/[,\n]+/).map(x => x.trim()).filter(Boolean);

class ApiError extends Error { constructor(message, code, status) { super(message); this.code = code; this.status = status; } }
async function api(path, payload, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (CFG.moz) headers["x-moz-token"] = CFG.moz;
  if (CFG.claude) headers["x-claude-key"] = CFG.claude;
  let reqBody = payload === undefined ? undefined : JSON.stringify(payload);
  if (reqBody && opts.gzip) {
    reqBody = await new Response(new Blob([reqBody]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    if (reqBody.byteLength > 4_300_000) throw new ApiError("Your Search Console file is too big to send in one go (over 4 MB compressed). Export a shorter date range or fewer rows, then upload it again.", "too_large", 413);
    headers["content-type"] = "application/octet-stream"; headers["x-body-encoding"] = "gzip";
  }
  const res = await fetch("/api/" + path, { method: payload === undefined ? "GET" : "POST", headers, body: reqBody, signal: opts.signal, credentials: "same-origin" });
  if (res.ok && res.headers.get("x-library-encoding") === "gzip") return await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).json();
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) { const er = (data && data.error) || {}; throw new ApiError(er.message || `Request failed (${res.status})`, er.code || "http_" + res.status, res.status); }
  return data;
}

// ---------- local storage for the library, reviews and checks (IndexedDB, this browser only) ----------
const IDB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open("cannibalization-checker", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("kv", mode); const req = fn(t.objectStore("kv")); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { get: (k) => tx("readonly", s => s.get(k)).catch(() => null), set: (k, v) => tx("readwrite", s => s.put(v, k)), del: (k) => tx("readwrite", s => s.delete(k)).catch(() => null) };
})();
const K = { up: () => "upload:" + siteDomain(), lib: () => "lib:" + siteDomain(), reviews: () => "reviews:" + siteDomain(), checks: () => "checks:" + siteDomain(), topics: () => "topicReviews:" + siteDomain() };

// ---------- state ----------
const S = {
  data: null,          // {inv:{cols,rows}, lib, ov, ku}
  meta: null, loadedAt: null, source: null,
  invByUrl: new Map(),
  kwGroups: [],        // cannibalized keyword groups
  reviews: new Map(),  // docId -> review
  topicReviews: {},    // topic -> Claude review text
  checks: [],
  lib: { section: "", q: "", cluster: "", status: "", overlap: "", intent: "", col: {}, sort: { key: "Clicks (3 mo)", dir: -1 }, page: 0, hidden: new Set(), open: null },
  cn: { mode: "kw", page: 0, tpage: 0 },
  readOnly: false, site: null, google: null, building: false, up: {},
};
// Claude, through this app's server with the user's own key. Same shape the artifact used (SAMPLE.json).
const CLAUDE = { json: async (prompt, opts = {}) => (await api("claude", { prompt, model: CFG.model }, { signal: opts.signal })).json };
let SAMPLE = null;
const syncClaude = () => { SAMPLE = CFG.claude && CFG.model ? CLAUDE : (S.mock ? CLAUDE : null); };

function setStatus(kind, html) { $("status-text").innerHTML = `<span class="dot ${kind}"></span>${html}`; }
function pageNotice(kind, html) { const n = $("page-notice"); if (!html) { n.hidden = true; n.innerHTML = ""; return; } n.className = "notice " + (kind || ""); n.innerHTML = html; n.hidden = false; }

function statusLine() {
  const d = S.loadedAt ? new Date(S.loadedAt) : null;
  const when = d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const src = S.meta && S.meta.mode === "gsc" ? "Search Console + Moz" : "Moz";
  return `${esc(siteDomain())} · ${src} · built ${when}`;
}
function saveLocal(key, value) { return IDB.set(key, value).catch(() => toast("Couldn't save in this browser (storage full or private mode).")); }
async function loadLocal() {
  const [rv, ch, tp, up] = await Promise.all([IDB.get(K.reviews()), IDB.get(K.checks()), IDB.get(K.topics()), IDB.get(K.up())]);
  S.up = up && typeof up === "object" ? up : {};
  S.reviews = new Map((rv || []).map(v => [docId(v.keyword), v]));
  S.checks = Array.isArray(ch) ? ch : [];
  S.topicReviews = tp && typeof tp === "object" ? tp : {};
}
const saveReviews = () => saveLocal(K.reviews(), [...S.reviews.values()]);

// ---------- model ----------
function colIdx(t, name) { return t.cols.indexOf(name); }
function asObjects(t) { return t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]]))); }

function applyData(data, loadedAt, source) {
  S.data = data; S.loadedAt = loadedAt; S.source = source;
  S.inv = asObjects(data.inv);
  S.invByUrl = new Map(S.inv.map(r => [norm(r["URL"]), r]));
  S.libRows = asObjects(data.lib);
  S.ov = asObjects(data.ov);
  buildKwGroups(asObjects(data.ku));
  updateStatus();
  $("loading").hidden = true;
  $("count-library").textContent = S.inv.length.toLocaleString();
  $("count-cannibalized").textContent = S.kwGroups.length.toLocaleString();
  initLibraryControls(); initCnControls();
  route();
}

function buildKwGroups(ku) {
  const m = new Map();
  for (const r of ku) {
    const k = String(r["Keyword"] || "").trim(); if (!k) continue;
    if (!m.has(k)) m.set(k, { keyword: k, volume: num(r["Search volume"]), severity: r["Severity"] || "", section: r["Section"] || "", source: r["Source"] || "", main: norm(r["Main URL"]), urls: [] });
    const g = m.get(k);
    g.urls.push({ url: norm(r["URL"]), role: r["Role"] === "Main" ? "Main" : "Cannibalizing", pos: num(r["Position"]), clicks: num(r["Clicks (3 mo)"]), impr: num(r["Impressions (3 mo)"]) });
  }
  // Keywords flagged in the library but without per-URL rows (older libraries): fall back to the Cannibalized URLs text.
  for (const r of S.libRows) {
    if (r["Cannibalized?"] !== "Yes") continue;
    const k = String(r["Keyword"] || "").trim(); if (!k || m.has(k)) continue;
    const g = { keyword: k, volume: num(r["Search volume"]), severity: r["Severity"] || "", section: r["Section"] || "", source: r["Source"] || "", main: norm(r["Top URL"]), urls: [{ url: norm(r["Top URL"]), role: "Main", pos: num(r["Top URL position"]), clicks: null, impr: null }] };
    for (const mm of String(r["Cannibalized URLs"] || "").matchAll(/(https?:\/\/\S+) \(#(\d+)\)/g)) g.urls.push({ url: norm(mm[1]), role: "Cannibalizing", pos: Number(mm[2]), clicks: null, impr: null });
    m.set(k, g);
  }
  S.kwGroups = [...m.values()].filter(g => g.urls.some(u => u.role === "Cannibalizing"));
  for (const g of S.kwGroups) {
    g.id = docId(g.keyword);
    const inv = S.invByUrl.get(g.main);
    g.cluster = inv ? inv["Topic cluster"] : "";
    g.impr = g.urls.reduce((a, u) => a + (u.impr || 0), 0);
    g.clicks = g.urls.reduce((a, u) => a + (u.clicks || 0), 0);
    g.urls.sort((a, b) => (a.role === "Main" ? -1 : b.role === "Main" ? 1 : (b.clicks || 0) - (a.clicks || 0) || (a.pos || 999) - (b.pos || 999)));
    g.hay = (g.keyword + " " + g.urls.map(u => u.url).join(" ")).toLowerCase();
  }
}

// ---------- rule-based recommendations ----------
const yearOf = (v) => { const m = String(v || "").match(/(19|20)\d\d/); return m ? Number(m[0]) : null; };
function ruleRec(g, u) {
  const main = g.urls.find(x => x.role === "Main") || g.urls[0];
  const im = S.invByUrl.get(main.url) || {}, ic = S.invByUrl.get(u.url) || {};
  const kw = `"${g.keyword}"`;
  if (u.role === "Main") return { action: "Keep as primary", cls: "good", text: (u.clicks != null ? "Most clicks" : "Best position") + " for this keyword. Keep it as the page that targets it and point internal links here with descriptive anchors." };
  const secM = im["Section"] || "", secC = ic["Section"] || "";
  if (u.pos == null && u.clicks == null) return { action: "Retarget or merge", cls: "warn", text: `Its title and URL target ${kw}, but ${short(main.url)} is the page that ranks${main.pos != null ? ` (#${fmt(main.pos)})` : ""}. Give this page its own angle in the title and H1 and link to ${short(main.url)} with ${kw} as the anchor, or merge it in if it adds little.` };
  const hubs = ["Learn", "Guide", "Product", "Resources", "Docs", "Academy"];
  const share = (u.clicks || 0) / Math.max(1, (u.clicks || 0) + (main.clicks || 0));
  const yr = yearOf(ic["Published"]);
  if (u.impr != null && u.impr < 20 && (u.pos == null || u.pos > 20))
    return { action: "No change", cls: "good", text: `Barely shows for ${kw} (${fmt(u.impr)} impressions). Leave it, and make sure it links to ${short(main.url)}.` };
  const intentM = String(im["Intent"] || "").toLowerCase(), intentC = String(ic["Intent"] || "").toLowerCase();
  if ((secM === "Product") !== (secC === "Product") || (intentM && intentC && intentM !== intentC))
    return { action: "Differentiate", cls: "neutral", text: `Different intent (${secC || intentC || "Other"} vs ${secM || intentM || "Other"}). Keep both: focus this page's title, H1 and intro on its own angle, and link to ${short(main.url)} with ${kw} as the anchor.` };
  if (hubs.includes(secC) && secM === "Blog")
    return { action: "Swap primary", cls: "warn", text: `This ${secC} page is the evergreen hub. Consider making it the target for ${kw}: re-point blog anchors to it and narrow the blog post to a supporting angle.` };
  if (u.pos != null && main.pos != null && u.pos <= 10 && main.pos <= 10 && share < 0.4)
    return { action: "Monitor", cls: "good", text: `Both pages sit on page 1 (#${fmt(main.pos)} and #${fmt(u.pos)}), which can earn two listings. Act only if positions start swapping or CTR falls.` };
  if (share >= 0.25 || (u.pos != null && main.pos != null && Math.abs(u.pos - main.pos) <= 5)) {
    if (secC === "Blog" && secM === "Blog") return { action: "Merge & 301", cls: "bad", text: `${u.clicks != null ? `Traffic is split (${Math.round(share * 100)}% of clicks here, ` : "Both rank close together ("}#${fmt(u.pos)} vs #${fmt(main.pos)}). Fold its unique sections into ${short(main.url)} and 301 redirect. Check backlinks first.` };
    return { action: "Differentiate", cls: "neutral", text: `Close competition (#${fmt(u.pos)} vs #${fmt(main.pos)}). Give this page a distinct sub-topic, rewrite its title and H1 away from ${kw}, and link to ${short(main.url)}.` };
  }
  if (secC === "Blog" && yr && yr <= 2018 && (u.clicks || 0) < 20)
    return { action: "Merge & 301", cls: "bad", text: `Older post (${yr}) with little traffic. Move anything still useful into ${short(main.url)}, then 301 redirect it.` };
  return { action: "De-optimize & link", cls: "warn", text: `Weaker match (#${fmt(u.pos)}${u.clicks != null ? `, ${fmt(u.clicks)} clicks` : ""}). Remove ${kw} from its title, H1 and headings, keep its own focus, and add a contextual link to ${short(main.url)}.` };
}


// ---------- LIBRARY ----------
const NUMERIC = new Set(["Target keyword volume", "Clicks (3 mo)", "Impressions (3 mo)", "Avg position", "Sessions (12 mo)"]);
const DEFAULT_COLS = ["URL", "Section", "Topic cluster", "Primary topic", "Target keyword", "Target keyword volume", "Ranking status", "Clicks (3 mo)", "Impressions (3 mo)", "Avg position", "Sessions (12 mo)", "Overlap type"];
let libInit = false;
function distinct(rows, key) { const m = new Map(); rows.forEach(r => { const v = String(r[key] ?? "").trim(); if (v) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }
function fillSelect(el, items, allLabel) { const cur = el.value; el.innerHTML = `<option value="">${esc(allLabel)}</option>` + items.map(([v, c]) => `<option value="${esc(v)}">${esc(v)} (${c.toLocaleString()})</option>`).join(""); el.value = cur; }

function initLibraryControls() {
  const cols = S.data.inv.cols;
  fillSelect($("lib-cluster"), distinct(S.inv, "Topic cluster"), "All clusters");
  fillSelect($("lib-status"), distinct(S.inv, "Ranking status"), "Any status");
  fillSelect($("lib-overlap"), distinct(S.inv, "Overlap type"), "Any overlap");
  fillSelect($("lib-intent"), distinct(S.inv, "Intent"), "Any intent");
  if (S.libColsFor !== S.loadedAt) {
    const hasVal = (c) => S.inv.some(r => r[c] !== "" && r[c] != null);
    S.lib.hidden = new Set(cols.filter(c => !DEFAULT_COLS.includes(c) || !hasVal(c)));
    S.lib.sort = hasVal("Clicks (3 mo)") ? { key: "Clicks (3 mo)", dir: -1 } : hasVal("Sessions (12 mo)") ? { key: "Sessions (12 mo)", dir: -1 } : { key: "Target keyword volume", dir: -1 };
    S.libColsFor = S.loadedAt;
  }
  if (!libInit) {
    const bind = (id, key) => $(id).addEventListener("input", e => { S.lib[key] = e.target.value; S.lib.page = 0; renderLibrary(); });
    bind("lib-q", "q"); bind("lib-cluster", "cluster"); bind("lib-status", "status"); bind("lib-overlap", "overlap"); bind("lib-intent", "intent");
    $("lib-more-btn").onclick = () => { const m = $("lib-more"); m.hidden = !m.hidden; $("lib-more-btn").setAttribute("aria-expanded", String(!m.hidden)); };
    $("lib-reset").onclick = () => { Object.assign(S.lib, { section: "", q: "", cluster: "", status: "", overlap: "", intent: "", col: {}, page: 0 }); ["lib-q", "lib-cluster", "lib-status", "lib-overlap", "lib-intent"].forEach(i => $(i).value = ""); $("lib-more").querySelectorAll("input,select").forEach(i => i.value = ""); renderLibrary(); };
    $("lib-copy").onclick = copyLibrary;
    libInit = true;
  }
  // every-column filters
  const more = $("lib-more"); more.innerHTML = "";
  cols.forEach((c, i) => {
    const id = "lc-" + i; const wrap = document.createElement("div"); wrap.className = "field";
    if (NUMERIC.has(c)) {
      wrap.innerHTML = `<label for="${id}-a">${esc(c)}</label><div class="minmax"><input type="number" id="${id}-a" placeholder="min"><input type="number" id="${id}-b" placeholder="max" aria-label="${esc(c)} max"></div>`;
      wrap.querySelectorAll("input").forEach((inp, j) => inp.addEventListener("input", () => { const f = S.lib.col[c] || {}; f[j ? "max" : "min"] = inp.value === "" ? null : Number(inp.value); S.lib.col[c] = f; S.lib.page = 0; renderLibrary(); }));
    } else {
      const d = distinct(S.inv, c);
      if (d.length && d.length <= 40) { wrap.innerHTML = `<label for="${id}">${esc(c)}</label><select id="${id}"></select>`; fillSelect(wrap.querySelector("select"), d, "Any"); }
      else wrap.innerHTML = `<label for="${id}">${esc(c)}</label><input type="text" id="${id}" placeholder="contains…">`;
      wrap.querySelector("input,select").addEventListener("input", e => { S.lib.col[c] = { eq: e.target.tagName === "SELECT" ? e.target.value : null, has: e.target.tagName === "INPUT" ? e.target.value.toLowerCase() : null }; S.lib.page = 0; renderLibrary(); });
    }
    more.appendChild(wrap);
  });
  $("lib-cols").innerHTML = cols.map((c, i) => `<label><input type="checkbox" data-col="${esc(c)}" ${S.lib.hidden.has(c) ? "" : "checked"}> ${esc(c)}</label>`).join("");
  $("lib-cols").querySelectorAll("input").forEach(cb => cb.onchange = () => { cb.checked ? S.lib.hidden.delete(cb.dataset.col) : S.lib.hidden.add(cb.dataset.col); renderLibrary(); });
}

function libFiltered(ignoreSection) {
  const L = S.lib, q = L.q.trim().toLowerCase();
  return S.inv.filter(r => {
    if (!ignoreSection && L.section && r["Section"] !== L.section) return false;
    if (L.cluster && r["Topic cluster"] !== L.cluster) return false;
    if (L.status && r["Ranking status"] !== L.status) return false;
    if (L.overlap && r["Overlap type"] !== L.overlap) return false;
    if (L.intent && r["Intent"] !== L.intent) return false;
    if (q && !(r._hay || (r._hay = [r["URL"], r["Page title"], r["Primary topic"], r["Target keyword"], r["Top URL for (keyword library)"], r["Competes for (keyword library)"]].join(" ").toLowerCase())).includes(q)) return false;
    for (const [c, f] of Object.entries(L.col)) {
      const v = r[c];
      if (f.eq && String(v) !== f.eq) return false;
      if (f.has && !String(v).toLowerCase().includes(f.has)) return false;
      if (f.min != null || f.max != null) { const n = num(v); if (n == null) return false; if (f.min != null && n < f.min) return false; if (f.max != null && n > f.max) return false; }
    }
    return true;
  });
}

function renderLibrary() {
  const L = S.lib;
  const base = libFiltered(true);
  const secs = distinct(base, "Section");
  $("lib-sections").innerHTML = `<button type="button" class="chip" aria-pressed="${!L.section}" data-sec="">All sections<span class="c">${base.length.toLocaleString()}</span></button>` + secs.map(([s, c]) => `<button type="button" class="chip" aria-pressed="${L.section === s}" data-sec="${esc(s)}">${esc(s)}<span class="c">${c.toLocaleString()}</span></button>`).join("");
  $("lib-sections").querySelectorAll("button").forEach(b => b.onclick = () => { L.section = b.dataset.sec; L.page = 0; renderLibrary(); });
  const rows = L.section ? base.filter(r => r["Section"] === L.section) : base;
  const sum = (k) => rows.reduce((a, r) => a + (num(r[k]) || 0), 0);
  const cnt = (f) => rows.filter(f).length;
  $("lib-stats").innerHTML = [
    ["URLs", rows.length, `of ${S.inv.length.toLocaleString()}`],
    ...(S.meta && S.meta.mode === "gsc" ? [["Clicks (3 mo)", DEMO ? MASK : sum("Clicks (3 mo)")], ["Impressions (3 mo)", DEMO ? MASK : sum("Impressions (3 mo)")]] : []),
    ...(S.inv.some(r => r["Sessions (12 mo)"] !== "" && r["Sessions (12 mo)"] != null) ? [["Sessions (12 mo)", DEMO ? MASK : sum("Sessions (12 mo)")]] : []),
    ["Ranking (top 20)", cnt(r => !String(r["Ranking status"]).startsWith("Not"))],
    ["Ranking cannibalization", cnt(r => String(r["Overlap type"]).toLowerCase().includes("ranking cannibalization"))],
    ["Topic overlap", cnt(r => String(r["Overlap type"]).toLowerCase().includes("topic overlap"))],
  ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v num">${fv(v)}${s ? `<small>${s}</small>` : ""}</div></div>`).join("");

  const { key, dir } = L.sort;
  const sorted = rows.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (NUMERIC.has(key)) return ((num(x) ?? -Infinity) - (num(y) ?? -Infinity)) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_LIB)); L.page = Math.min(L.page, pages - 1);
  const slice = sorted.slice(L.page * PAGE_LIB, (L.page + 1) * PAGE_LIB);
  const cols = S.data.inv.cols.filter(c => !L.hidden.has(c));
  $("lib-meta").textContent = `${sorted.length.toLocaleString()} URLs · sorted by ${key} ${dir < 0 ? "↓" : "↑"}`;
  const th = cols.map(c => `<th class="${NUMERIC.has(c) ? "n" : ""}"><button type="button" data-sort="${esc(c)}">${esc(c === "URL" ? "Page" : c)}${key === c ? (dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("");
  const cell = (r, c) => {
    const v = r[c];
    if (c === "URL") return `<td class="url-cell"><span class="t">${esc(r["Page title"] || short(v))}</span><span class="u">${link(v)}</span></td>`;
    if (NUMERIC.has(c)) return `<td class="n">${SENS.has(c) ? fmtS(num(v)) : fmt(num(v))}</td>`;
    if (c === "Ranking status") return `<td><span class="pill ${/^(Top 3|Page 1)/.test(String(v)) ? "good" : /^Page 2/.test(String(v)) ? "warn" : String(v).includes("Not") ? "bad" : "neutral"}">${esc(v || "–")}</span></td>`;
    if (c === "Overlap type") return `<td>${v && v !== "None" ? `<span class="pill ${String(v).toLowerCase().includes("ranking") ? "high" : "medium"}">${esc(v)}</span>` : `<span class="muted">None</span>`}</td>`;
    if (c === "Section") return `<td><span class="pill neutral">${esc(v)}</span></td>`;
    const s = String(v ?? ""); return `<td class="clip">${linkify(s.length > 160 ? s.slice(0, 160) + "…" : s)}</td>`;
  };
  const body = slice.map(r => {
    const open = L.open === r["URL"];
    let h = `<tr class="row" data-url="${esc(r["URL"])}" tabindex="0" aria-expanded="${open}">${cols.map(c => cell(r, c)).join("")}</tr>`;
    if (open) h += `<tr class="detail"><td colspan="${cols.length}"><dl class="kv">${S.data.inv.cols.map(c => `<dt>${esc(c)}</dt><dd>${DEMO && SENS.has(c) ? MASK : linkify(r[c])}</dd>`).join("")}</dl></td></tr>`;
    return h;
  }).join("");
  $("lib-table").innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="empty">No URLs match these filters.</td></tr>`}</tbody>`;
  $("lib-table").querySelectorAll("th button").forEach(b => b.onclick = () => { const k = b.dataset.sort; L.sort = { key: k, dir: L.sort.key === k ? -L.sort.dir : (NUMERIC.has(k) ? -1 : 1) }; renderLibrary(); });
  $("lib-table").querySelectorAll("tr.row").forEach(tr => { const t = () => { L.open = L.open === tr.dataset.url ? null : tr.dataset.url; renderLibrary(); }; tr.onclick = (e) => { if (e.target.closest("a")) return; t(); }; tr.onkeydown = (e) => { if (e.key === "Enter") t(); }; });
  pager($("lib-pager"), L.page, pages, (p) => { L.page = p; renderLibrary(); });
}

function pager(el, page, pages, go) {
  if (pages <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = `<button class="btn small" type="button" ${page ? "" : "disabled"} data-p="${page - 1}">Previous</button><span class="small muted num">Page ${page + 1} of ${pages}</span><button class="btn small" type="button" ${page < pages - 1 ? "" : "disabled"} data-p="${page + 1}">Next</button>`;
  el.querySelectorAll("button").forEach(b => b.onclick = () => { go(Number(b.dataset.p)); el.closest("section").scrollIntoView({ block: "start" }); });
}

async function copyLibrary() {
  const cols = S.data.inv.cols;
  const rows = libFiltered(false);
  const tsv = [cols.join("\t")].concat(rows.map(r => cols.map(c => (DEMO && SENS.has(c)) ? "" : maskText(r[c]).replace(/[\t\n]+/g, " ")).join("\t"))).join("\n");
  try { await navigator.clipboard.writeText(tsv); toast(`Copied ${rows.length.toLocaleString()} rows. Paste into a sheet.`); }
  catch (e) { toast("Your browser blocked copying. Select the table instead."); }
}

// ---------- CANNIBALIZED ----------
let cnInit = false;
const SEV_RANK = { High: 3, Medium: 2, Low: 1 };
function initCnControls() {
  fillSelect($("cn-sev"), distinct(S.kwGroups, "severity"), "Any severity");
  fillSelect($("cn-section"), distinct(S.kwGroups, "section"), "Any section");
  fillSelect($("cn-cluster"), distinct(S.kwGroups, "cluster"), "All clusters");
  fillSelect($("ct-cluster"), distinct(S.ov, "Cluster"), "All clusters");
  if (cnInit) return;
  ["cn-q", "cn-sev", "cn-section", "cn-cluster", "cn-review", "cn-minvol", "cn-sort"].forEach(id => $(id).addEventListener("input", () => { S.cn.page = 0; renderCn(); }));
  ["ct-q", "ct-cluster", "ct-ev", "ct-sort"].forEach(id => $(id).addEventListener("input", () => { S.cn.tpage = 0; renderCn(); }));
  const setMode = (m) => { S.cn.mode = m; $("cn-mode-kw").setAttribute("aria-pressed", m === "kw"); $("cn-mode-topic").setAttribute("aria-pressed", m === "topic"); renderCn(); };
  $("cn-mode-kw").onclick = () => setMode("kw"); $("cn-mode-topic").onclick = () => setMode("topic");
  $("cn-ask-page").onclick = () => S.cn.mode === "topic" ? reviewTopics(S.cn.tvisible || []) : reviewBatch(S.cn.visible || []);
  $("cn-stop").onclick = () => { S.cn.ctl && S.cn.ctl.abort(); };
  cnInit = true;
}

function cnFiltered() {
  const q = $("cn-q").value.trim().toLowerCase(), sev = $("cn-sev").value, sec = $("cn-section").value, cl = $("cn-cluster").value, rv = $("cn-review").value, mv = num($("cn-minvol").value) || 0;
  const out = S.kwGroups.filter(g => (!q || g.hay.includes(q)) && (!sev || g.severity === sev) && (!sec || g.section === sec) && (!cl || g.cluster === cl) && ((g.volume || 0) >= mv) && (!rv || (rv === "yes") === S.reviews.has(g.id)));
  const s = $("cn-sort").value;
  const cmp = { vol: (a, b) => (b.volume || 0) - (a.volume || 0), impr: (a, b) => b.impr - a.impr, sev: (a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || (b.volume || 0) - (a.volume || 0), urls: (a, b) => b.urls.length - a.urls.length, kw: (a, b) => a.keyword.localeCompare(b.keyword) }[s];
  return out.sort(cmp);
}

function renderCn() {
  const topic = S.cn.mode === "topic";
  $("cn-kw-filters").hidden = topic; $("cn-topic-filters").hidden = !topic;
  $("cn-ask-page").textContent = topic ? "Ask Claude to review this page of topic groups" : "Ask Claude to review this page of keywords";
  $("cn-mode-help").textContent = topic ? "Groups of pages that cover the same topic, with Claude's review of each group." : (S.meta && S.meta.mode === "gsc" ? "Keywords where more than one of your URLs gets real impressions (Search Console query → page data, Moz for the rest)." : "Keywords where more than one of your URLs competes: close keyword variants ranking different pages (Moz), and pages whose title and URL target a keyword another page ranks for.");
  return topic ? renderTopics() : renderKeywords();
}

function renderKeywords() {
  const list = cnFiltered();
  const comp = list.reduce((a, g) => a + g.urls.filter(u => u.role !== "Main").length, 0);
  const reviewed = list.filter(g => S.reviews.has(g.id)).length;
  $("cn-stats").innerHTML = [
    ["Cannibalized keywords", list.length, `of ${S.kwGroups.length.toLocaleString()}`],
    ["Competing URLs", comp],
    ["High severity", list.filter(g => g.severity === "High").length],
    ["Impressions at stake", DEMO ? MASK : list.reduce((a, g) => a + g.impr, 0)],
    ["Reviewed by Claude", reviewed, list.length ? `${Math.round(reviewed / list.length * 100)}%` : ""],
  ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v num">${fv(v)}${s ? `<small>${s}</small>` : ""}</div></div>`).join("");
  const pages = Math.max(1, Math.ceil(list.length / PAGE_KW)); S.cn.page = Math.min(S.cn.page, pages - 1);
  const slice = list.slice(S.cn.page * PAGE_KW, (S.cn.page + 1) * PAGE_KW);
  S.cn.visible = slice;
  $("cn-meta").textContent = `${list.length.toLocaleString()} keywords · showing ${slice.length}`;
  $("cn-ask-page").disabled = !SAMPLE || !slice.length || !!S.cn.ctl;
  $("cn-ask-page").title = SAMPLE ? "" : "Add your Claude API key and model in Settings";
  $("cn-body").innerHTML = slice.length ? `<div class="kw-list">${slice.map(kwCard).join("")}</div>` : `<div class="empty">No cannibalized keywords match these filters.</div>`;
  $("cn-body").querySelectorAll("[data-ask]").forEach(b => b.onclick = () => reviewBatch(S.kwGroups.filter(g => g.id === b.dataset.ask)));
  pager($("cn-pager"), S.cn.page, pages, (p) => { S.cn.page = p; renderKeywords(); });
}

function kwCard(g) {
  const rv = S.reviews.get(g.id);
  const rvBy = rv ? new Map((rv.urls || []).map(x => [norm(x.url), x])) : new Map();
  const sev = String(g.severity || "").toLowerCase();
  const rows = g.urls.map(u => {
    const inv = S.invByUrl.get(u.url) || {};
    const r = ruleRec(g, u), c = rvBy.get(u.url);
    const rec = c
      ? `<div class="rec claude-rec"><div><span class="pill claude">${esc(c.action || "Claude")}</span></div><div>${linkify(c.recommendation || "")}</div><div class="src">Claude review · rule check: ${esc(r.action)}</div></div>`
      : `<div class="rec"><div><span class="pill ${r.cls}">${esc(r.action)}</span></div><div>${linkify(r.text)}</div><div class="src">Rule-based best practice</div></div>`;
    return `<tr><td><span class="role ${u.role === "Main" ? "main" : "cann"}">${u.role === "Main" ? "Main URL" : "Cannibalizing"}</span></td>
      <td class="url-cell"><span class="t">${esc(inv["Page title"] || short(u.url))}</span><span class="u">${link(u.url)}${inv["Section"] ? ` · ${esc(inv["Section"])}` : ""}${yearOf(inv["Published"]) ? ` · ${yearOf(inv["Published"])}` : ""}</span></td>
      <td class="n">${u.pos == null ? "–" : "#" + fmt(u.pos)}</td><td class="n">${fmtS(u.clicks)}</td><td class="n">${fmtS(u.impr)}</td><td>${rec}</td></tr>`;
  }).join("");
  const when = rv && rv.reviewedAt ? new Date(rv.reviewedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  return `<article class="kw sev-${esc(sev)}">
    <div class="kw-head"><div class="tags"><h3>${esc(g.keyword)}</h3>
      <span class="pill ${esc(sev)}">${esc(g.severity || "–")}</span>
      <span class="num">${fmt(g.volume)} searches/mo</span>${g.cluster ? `<span>· ${esc(g.cluster)}</span>` : ""}<span>· ${esc(g.section)}</span><span>· source ${esc(g.source)}</span></div>
      <button class="btn small ${rv ? "" : "claude"}" type="button" data-ask="${esc(g.id)}" ${SAMPLE && !S.cn.ctl ? "" : "disabled"}>${rv ? "Ask Claude again" : "Ask Claude"}</button></div>
    ${rv && rv.summary ? `<div class="kw-summary"><b>Claude${when ? " · " + when : ""}:</b> ${linkify(rv.summary)}</div>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Role</th><th>URL</th><th class="n">Avg pos.</th><th class="n">Clicks</th><th class="n">Impr.</th><th>Recommendation</th></tr></thead><tbody>${rows}</tbody></table></div>
  </article>`;
}

function renderTopics() {
  const q = $("ct-q").value.trim().toLowerCase(), cl = $("ct-cluster").value, ev = $("ct-ev").value, s = $("ct-sort").value;
  const list = S.ov.filter(r => (!cl || r["Cluster"] === cl) && (!ev || r["Ranking cannibalization evidence?"] === ev) && (!q || [r["Topic"], r["Strongest page"], r["Other pages (clicks, year, status)"]].join(" ").toLowerCase().includes(q)));
  const key = { impr: "Total impressions (3 mo)", clicks: "Total clicks (3 mo)", pages: "# pages" }[s];
  list.sort((a, b) => key ? (num(b[key]) || 0) - (num(a[key]) || 0) : String(a["Topic"]).localeCompare(String(b["Topic"])));
  $("cn-stats").innerHTML = [
    ["Topic groups", list.length, `of ${S.ov.length.toLocaleString()}`],
    ["Pages in groups", list.reduce((a, r) => a + (num(r["# pages"]) || 0), 0)],
    ["With ranking evidence", list.filter(r => r["Ranking cannibalization evidence?"] === "Yes").length],
    ...(S.meta && S.meta.mode === "gsc" ? [["Impressions", DEMO ? MASK : list.reduce((a, r) => a + (num(r["Total impressions (3 mo)"]) || 0), 0)]] : []),
    ["Reviewed by Claude", list.filter(r => S.topicReviews[r["Topic"]]).length],
  ].map(([k, v, sub]) => `<div class="stat"><div class="k">${k}</div><div class="v num">${fv(v)}${sub ? `<small>${sub}</small>` : ""}</div></div>`).join("");
  const pages = Math.max(1, Math.ceil(list.length / PAGE_LIB)); S.cn.tpage = Math.min(S.cn.tpage, pages - 1);
  const slice = list.slice(S.cn.tpage * PAGE_LIB, (S.cn.tpage + 1) * PAGE_LIB);
  S.cn.tvisible = slice.slice(0, 24);
  $("cn-meta").textContent = `${list.length.toLocaleString()} topic groups`;
  $("cn-ask-page").disabled = !SAMPLE || !slice.length || !!S.cn.ctl;
  $("cn-ask-page").title = SAMPLE ? "Reviews the first 24 groups on this page" : "Add your Claude API key and model in Settings";
  $("cn-body").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Topic</th><th class="n">Pages</th><th class="n">Clicks</th><th class="n">Impr.</th><th>Strongest page</th><th>Other pages</th><th>Evidence</th><th>Claude review</th></tr></thead><tbody>${slice.map(r => `<tr>
    <td><strong>${esc(r["Topic"])}</strong><div class="small muted">${esc(r["Cluster"])}</div></td>
    <td class="n">${fmt(num(r["# pages"]))}</td><td class="n">${fmtS(num(r["Total clicks (3 mo)"]))}</td><td class="n">${fmtS(num(r["Total impressions (3 mo)"]))}</td>
    <td class="url-cell"><span class="u">${link(r["Strongest page"])}</span><div class="small muted">${esc(maskText(r["Strongest page stats"]))}</div></td>
    <td class="clip" style="max-width:340px;white-space:pre-wrap">${linkify(r["Other pages (clicks, year, status)"])}</td>
    <td>${r["Ranking cannibalization evidence?"] === "Yes" ? '<span class="pill high">Yes</span>' : '<span class="pill low">No</span>'}</td>
    <td class="rec ${S.topicReviews[r["Topic"]] ? "claude-rec" : ""}" style="max-width:360px"><div>${linkify(S.topicReviews[r["Topic"]] || r["Suggested action"])}</div><div class="src">${S.topicReviews[r["Topic"]] ? "Claude review" : "Rule-based suggestion"}</div></td></tr>`).join("") || `<tr><td colspan="8" class="empty">No topic groups match.</td></tr>`}</tbody></table></div>`;
  pager($("cn-pager"), S.cn.tpage, pages, (p) => { S.cn.tpage = p; renderTopics(); });
}

// ---------- Claude reviews ----------
const REVIEW_RULES = () => `You are a senior technical SEO reviewing keyword cannibalization on ${siteDomain()}.
Best practice to apply:
- One primary URL per search intent. The "Main" URL (most Search Console clicks, or best position when only Moz data is available) is usually primary, unless a hub, guide, learn or product/tool page clearly matches the intent better: then recommend swapping.
- Merge & 301: same intent, the weaker page adds little unique value or traffic. Fold unique sections into the primary, then 301. Flag checking backlinks first (older posts often carry links).
- Differentiate: both pages deserve to exist but should target different sub-intents. Say what angle the weaker page should take and what to change (title, H1, intro, headings).
- De-optimize & link: weaker page should stop targeting the keyword. Remove it from title/H1/headings and add a contextual internal link to the primary with a descriptive anchor.
- Canonicalize: near-duplicates that must both stay live.
- Keep & monitor: different intents legitimately sharing a SERP (tool page vs guide), both on page 1 with healthy CTR, or negligible exposure (<20 impressions).
- Never recommend noindex or deletion as a first step for pages with traffic or links.
Be specific to the URLs and numbers. Each recommendation max 45 words.`;

function reviewPayload(g) {
  return {
    keyword: g.keyword, monthly_volume: g.volume, severity: g.severity,
    urls: g.urls.map(u => { const inv = S.invByUrl.get(u.url) || {}; return { url: u.url, role: u.role, avg_position: u.pos, clicks_3mo: u.clicks, impressions_3mo: u.impr, section: inv["Section"] || "", title: inv["Page title"] || "", published: inv["Published"] || "", intent: inv["Intent"] || "", primary_topic: inv["Primary topic"] || "" }; }),
  };
}

function sampleCopy(e) {
  switch (e && e.code) {
    case "not_granted": case "sampling_disabled": case "not_declared": case "capability_disabled": case "capability_removed": return "Asking Claude isn't allowed in this view.";
    case "rate_limited": return "Claude is busy or you've hit a usage limit. Try again in a little while.";
    case "session_expired": return "Sign in to claude.ai again, then retry.";
    case "invalid_json": return "Claude's answer couldn't be read. Try again with fewer keywords.";
    case "refused": return "Claude declined this request.";
    case "cancelled": return "Stopped.";
    default: if (e && e.name === "AbortError") return "Stopped."; return (e && e.message) || "Claude couldn't answer just now. Try again.";
  }
}

async function reviewBatch(groups) {
  if (!SAMPLE || !groups.length || S.cn.ctl) return;
  const ctl = new AbortController(); S.cn.ctl = ctl;
  $("cn-stop").hidden = false; renderKeywords();
  const BATCH = 5; let done = 0, failed = "";
  try {
    for (let i = 0; i < groups.length && !ctl.signal.aborted; i += BATCH) {
      const chunk = groups.slice(i, i + BATCH);
      $("cn-progress").textContent = `Claude is reviewing ${done + 1}–${done + chunk.length} of ${groups.length}…`;
      const prompt = `${REVIEW_RULES()}

Data (${S.meta && S.meta.mode === "gsc" ? "Search Console last 3 months; positions are average positions" : "Moz ranking data: positions are current Google positions; clicks and impressions are unknown (null)"}):
${JSON.stringify(chunk.map(reviewPayload))}

Reply with only a JSON array, one object per keyword, in this shape:
[{"keyword": string, "summary": string (one sentence: the fix for this keyword), "urls": [{"url": string, "action": "Keep as primary"|"Swap primary"|"Merge & 301"|"Differentiate"|"De-optimize & link"|"Canonicalize"|"Keep & monitor", "recommendation": string}]}]
Include every URL from the data, including the Main URL.`;
      let out;
      try { out = await SAMPLE.json(prompt, { signal: ctl.signal, modelTier: "default" }); }
      catch (e) { failed = sampleCopy(e); if (e && (e.code === "not_granted" || e.code === "sampling_disabled")) SAMPLE = null; break; }
      const arr = Array.isArray(out) ? out : (out && Array.isArray(out.keywords) ? out.keywords : []);
      for (const item of arr) {
        const g = chunk.find(x => x.keyword.toLowerCase() === String(item.keyword || "").toLowerCase());
        if (!g) continue;
        const doc = { keyword: g.keyword, summary: String(item.summary || "").slice(0, 600), urls: (item.urls || []).slice(0, 30).map(u => ({ url: norm(u.url), action: String(u.action || "").slice(0, 40), recommendation: String(u.recommendation || "").slice(0, 600) })), reviewedAt: new Date().toISOString(), by: "app" };
        S.reviews.set(g.id, doc);
      }
      await saveReviews();
      done += chunk.length; renderKeywords();
    }
  } finally {
    S.cn.ctl = null; $("cn-stop").hidden = true;
    $("cn-progress").textContent = failed || (ctl.signal.aborted ? "Stopped." : `Reviewed ${done} keyword${done === 1 ? "" : "s"}. Saved in this browser.`);
    renderKeywords();
  }
}


// ---------- TOPIC CHECK ----------
const STOP = new Set("a an and are as at be by can do does for from how i in into is it its my of on or our should the this to vs what when where which who why will with you your guide best ways way tips 2024 2025 2026 complete ultimate".split(" "));
const stem = (w) => w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "").replace(/(ation)$/, "ate");
const toks = (s) => String(s || "").toLowerCase().replace(/https?:\/\/[^\/\s]+/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 1 && !STOP.has(w)).map(stem);
let tcIndex = null, tcLast = null;
function buildIndex() {
  const df = new Map();
  const docs = S.inv.map(r => {
    const fields = { title: toks(r["Page title"]), topic: toks(r["Primary topic"]), kw: toks(r["Target keyword"]), url: toks(short(r["URL"])), lib: toks(r["Top URL for (keyword library)"]) };
    new Set(Object.values(fields).flat()).forEach(t => df.set(t, (df.get(t) || 0) + 1));
    return { r, fields };
  });
  tcIndex = { docs, df, N: docs.length };
}
function scorePage(q, d) {
  const W = { title: 1.0, topic: 1.2, kw: 1.1, url: 0.7, lib: 0.5 };
  const idf = (t) => Math.log(1 + tcIndex.N / (1 + (tcIndex.df.get(t) || 0)));
  const total = q.reduce((a, t) => a + idf(t), 0) || 1;
  let best = 0;
  for (const [f, w] of Object.entries(W)) {
    const set = new Set(d.fields[f]);
    const hit = q.reduce((a, t) => a + (set.has(t) ? idf(t) : 0), 0) / total;
    best = Math.max(best, hit * w);
  }
  return Math.min(1, best);
}
function runCheck(topic, kw) {
  if (!tcIndex) buildIndex();
  const q = [...new Set(toks(topic + " " + kw))];
  if (!q.length) return null;
  const pages = tcIndex.docs.map(d => ({ r: d.r, s: scorePage(q, d) })).filter(x => x.s >= 0.3).sort((a, b) => b.s - a.s || (num(b.r["Clicks (3 mo)"]) || 0) - (num(a.r["Clicks (3 mo)"]) || 0)).slice(0, 12);
  const kq = [...new Set(toks(kw || topic))];
  const kws = S.libRows.map(r => { const t = new Set(toks(r["Keyword"])); const hit = kq.filter(x => t.has(x)).length; return { r, s: kq.length ? hit / Math.max(kq.length, t.size) : 0 }; }).filter(x => x.s >= 0.5).sort((a, b) => b.s - a.s || (num(b.r["Search volume"]) || 0) - (num(a.r["Search volume"]) || 0)).slice(0, 15);
  const top = pages[0];
  let verdict;
  const tnorm = " " + String(topic).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const exactKw = S.libRows.filter(r => { const k = String(r["Keyword"]).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return k.includes(" ") && tnorm.includes(" " + k + " "); }).sort((a, b) => String(b["Keyword"]).length - String(a["Keyword"]).length || (num(b["Search volume"]) || 0) - (num(a["Search volume"]) || 0))[0];
  if (exactKw) verdict = { cls: "v-exists", label: "Already ranking", title: `${siteDomain()} already ranks for "${exactKw["Keyword"]}"`, text: `${short(exactKw["Top URL"])} ranks #${fmt(num(exactKw["Top URL position"]))} for it ${num(exactKw["Search volume"]) != null ? `(${fmt(num(exactKw["Search volume"]))} searches/mo)` : ""}. Refresh or expand that page instead of writing a new one${exactKw["Cannibalized?"] === "Yes" ? ", and fix the cannibalization already on this keyword first" : ""}.`, url: exactKw["Top URL"] };
  else if (top && top.s >= 0.75) verdict = { cls: "v-exists", label: "Covered", title: "This topic already has a page", text: `${short(top.r["URL"])} (${[top.r["Section"], top.r["Ranking status"], num(top.r["Clicks (3 mo)"]) != null ? fmt(num(top.r["Clicks (3 mo)"])) + " clicks" : ""].filter(Boolean).join(", ")}) covers it closely. Update that page, or pick a clearly different angle and link to it.`, url: top.r["URL"] };
  else if (top && top.s >= 0.45) verdict = { cls: "v-partial", label: "Related coverage", title: "Partly covered: choose a distinct angle", text: `Closest is ${short(top.r["URL"])}. A new piece can work if it targets a different intent or sub-topic. Link it to the existing page and avoid its main keyword.`, url: top.r["URL"] };
  else verdict = { cls: "v-gap", label: "Gap", title: "No existing page covers this", text: "Nothing in the library matches closely. This looks safe to write. Link it from the most relevant hub page in its cluster." };
  return { topic, kw, pages, kws, verdict };
}
function renderCheck(res) {
  tcLast = res;
  $("tc-ask").disabled = !res || !SAMPLE;
  if (!res) { $("tc-verdicts").innerHTML = '<div class="empty">Type a topic to check.</div>'; $("tc-pages").innerHTML = ""; $("tc-kws").innerHTML = ""; return; }
  const v = res.verdict;
  $("tc-verdicts").innerHTML = `<div class="verdict ${v.cls}"><span class="label">Library match · ${esc(v.label)}${res.example ? " · example check" : ""}</span><h2>${esc(v.title)}</h2><div>${linkify(v.text)}</div></div><div id="tc-claude" style="margin-top:10px"></div>`;
  $("tc-count").textContent = `${res.pages.length} shown`;
  $("tc-pages").innerHTML = res.pages.length ? res.pages.map(p => `<div class="match"><div class="url-cell" style="max-width:none"><span class="t">${esc(p.r["Page title"] || short(p.r["URL"]))}</span><span class="u">${link(p.r["URL"])} · ${esc(p.r["Section"])} · ${esc(p.r["Topic cluster"])}</span><div class="small muted">Topic: ${esc(p.r["Primary topic"])} · Target: ${esc(p.r["Target keyword"])} · ${esc(p.r["Ranking status"])} ${num(p.r["Clicks (3 mo)"]) != null ? ` · ${fmtS(num(p.r["Clicks (3 mo)"]))} clicks` : ""}</div></div><div class="small muted num" style="text-align:right">${Math.round(p.s * 100)}% match<div class="bar"><i style="width:${Math.round(p.s * 100)}%"></i></div></div></div>`).join("") : '<div class="empty small">No close pages.</div>';
  $("tc-kwcount").textContent = `${res.kws.length} shown`;
  $("tc-kws").innerHTML = res.kws.length ? `<div class="table-wrap"><table><thead><tr><th>Keyword</th><th class="n">Volume</th><th>Ranking URL</th><th class="n">Pos.</th><th>Cannibalized?</th></tr></thead><tbody>${res.kws.map(k => `<tr><td>${esc(k.r["Keyword"])}</td><td class="n">${fmt(num(k.r["Search volume"]))}</td><td>${link(k.r["Top URL"])}</td><td class="n">${fmt(num(k.r["Top URL position"]))}</td><td>${k.r["Cannibalized?"] === "Yes" ? `<span class="pill ${String(k.r["Severity"]).toLowerCase()}">Yes · ${esc(k.r["Severity"])}</span>` : `<span class="muted">${esc(k.r["Cannibalized?"] || "No")}</span>`}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty small">No ranking keywords match.</div>';
}
let tcInit = false, tcBound = false;
function ensureTopicCheck() {
  if (!tcBound) { tcBound = true; $("tc-form").addEventListener("submit", (e) => { e.preventDefault(); renderCheck(runCheck($("tc-topic").value, "")); }); $("tc-ask").onclick = askClaudeTopic; }
  if (tcInit) { $("tc-ask").disabled = !tcLast || !SAMPLE; return; } tcInit = true;
  const ex = S.inv.find(r => r["Target keyword"]) || S.inv[0];
  $("tc-topic").value = ex ? String(ex["Primary topic"] || ex["Target keyword"] || "") : "";
  const r = runCheck($("tc-topic").value, ""); if (r) r.example = true; renderCheck(r);
  renderHistory();
}
async function askClaudeTopic() {
  const res = tcLast; if (!res || !SAMPLE) return;
  const box = $("tc-claude"); const btn = $("tc-ask"); btn.disabled = true;
  box.innerHTML = '<div class="verdict v-claude"><span class="label">Claude</span><div>Thinking…</div></div>';
  const cand = res.pages.slice(0, 10).map(p => ({ url: p.r["URL"], section: p.r["Section"], title: p.r["Page title"], published: p.r["Published"], primary_topic: p.r["Primary topic"], cluster: p.r["Topic cluster"], intent: p.r["Intent"], target_keyword: p.r["Target keyword"], ranking_status: p.r["Ranking status"], clicks_3mo: num(p.r["Clicks (3 mo)"]), impressions_3mo: num(p.r["Impressions (3 mo)"]), overlap: p.r["Overlap type"] }));
  const kws = res.kws.slice(0, 12).map(k => ({ keyword: k.r["Keyword"], volume: num(k.r["Search volume"]), top_url: k.r["Top URL"], position: num(k.r["Top URL position"]), cannibalized: k.r["Cannibalized?"] }));
  const site = siteDomain(), clicksKnown = S.meta && S.meta.mode === "gsc";
  const prompt = `You are ${brandName()}'s SEO content strategist. A writer wants to publish on ${site}:
Topic or working title: ${JSON.stringify(res.topic)}

Closest existing ${site} pages (${clicksKnown ? "Search Console last 3 months" : "Moz ranking data; clicks unknown"}):
${JSON.stringify(cand)}
${site} keywords already ranking that match:
${JSON.stringify(kws)}

Decide whether writing a new page would cannibalize existing content. Prefer refreshing a strong existing page over a new one on the same intent; recommend a new page only for a distinct intent or a real gap; recommend merging first when several weak pages already split the topic.
Reply with only JSON: {"verdict": "Write new"|"Refresh existing"|"Merge first"|"Differentiate", "reason": string (max 60 words), "primary_url": string or "", "suggested_angle": string (max 30 words), "suggested_target_keyword": string, "link_to": [up to 3 URLs]}`;
  try {
    const out = await SAMPLE.json(prompt);
    box.innerHTML = `<div class="verdict v-claude"><span class="label">Claude's verdict</span><h2>${esc(out.verdict || "")}</h2><div>${linkify(out.reason || "")}</div>
      ${out.primary_url ? `<div class="small"><b>Page to work on:</b> ${link(out.primary_url)}</div>` : ""}
      ${out.suggested_angle ? `<div class="small"><b>Angle:</b> ${esc(out.suggested_angle)}</div>` : ""}
      ${out.suggested_target_keyword ? `<div class="small"><b>Target keyword:</b> ${esc(out.suggested_target_keyword)}</div>` : ""}
      ${Array.isArray(out.link_to) && out.link_to.length ? `<div class="small"><b>Link to:</b> ${out.link_to.map(u => link(u)).join(", ")}</div>` : ""}</div>`;
    S.checks.unshift({ topic: String(res.topic).slice(0, 300), keyword: String(res.kw || "").slice(0, 120), verdict: String(out.verdict || "").slice(0, 40), reason: String(out.reason || "").slice(0, 600), primary_url: String(out.primary_url || "").slice(0, 300), angle: String(out.suggested_angle || "").slice(0, 300), at: new Date().toISOString() });
    S.checks = S.checks.slice(0, 30); saveLocal(K.checks(), S.checks); renderHistory();
  } catch (e) {
    box.innerHTML = `<div class="verdict v-claude"><span class="label">Claude</span><div>${esc(e && e.text ? e.text : sampleCopy(e))}</div></div>`;
  } finally { btn.disabled = !SAMPLE; }
}
function renderHistory() {
  const el = $("tc-history"); if (!el) return;
  el.innerHTML = S.checks.length ? S.checks.map((c, i) => `<div class="match" style="grid-template-columns:1fr"><div><button class="btn small" type="button" data-h="${i}" style="float:right">Re-run</button><strong>${esc(c.topic)}</strong><div class="small"><span class="pill claude">${esc(c.verdict)}</span> <span class="muted">${c.at ? new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span></div><div class="small muted">${linkify(c.reason)}</div></div></div>`).join("") : '<div class="empty small">No saved checks yet. Claude verdicts are saved here, in this browser.</div>';
  el.querySelectorAll("[data-h]").forEach(b => b.onclick = () => { const c = S.checks[Number(b.dataset.h)]; $("tc-topic").value = c.topic; renderCheck(runCheck(c.topic, "")); });
}


// ---------- Claude reviews of topic groups ----------
const TOPIC_RULES = `You are a senior SEO reviewing topic overlap on SITE: groups of pages that cover the same topic.
For each group decide what to do: keep one primary page and merge (301) weak duplicates into it, differentiate pages that deserve to exist by giving each its own sub-intent, or keep & cross-link when the pages already serve different intents. "Ranking cannibalization evidence" = Yes means the pages already compete for the same keywords in search, which makes acting more urgent.
Never recommend noindex or deletion as a first step for pages with traffic or links. Be specific to the URLs. Max 60 words per group.`;
async function reviewTopics(rows) {
  if (!SAMPLE || !rows.length || S.cn.ctl) return;
  const ctl = new AbortController(); S.cn.ctl = ctl;
  $("cn-stop").hidden = false; renderTopics();
  const BATCH = 8; let done = 0, failed = "";
  try {
    for (let i = 0; i < rows.length && !ctl.signal.aborted; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      $("cn-progress").textContent = `Claude is reviewing groups ${done + 1}–${done + chunk.length} of ${rows.length}…`;
      const data = chunk.map(r => ({ topic: r["Topic"], cluster: r["Cluster"], strongest_page: r["Strongest page"], strongest_page_stats: r["Strongest page stats"], other_pages: String(r["Other pages (clicks, year, status)"] || "").split(/\n|; /).filter(Boolean), ranking_cannibalization_evidence: r["Ranking cannibalization evidence?"], pages: r["# pages"] }));
      const prompt = `${TOPIC_RULES.replace("SITE", siteDomain())}

Groups:
${JSON.stringify(data)}

Reply with only a JSON array: [{"topic": string (exactly as given), "review": string}]`;
      let out;
      try { out = await SAMPLE.json(prompt, { signal: ctl.signal }); }
      catch (e) { failed = sampleCopy(e); break; }
      const arr = Array.isArray(out) ? out : (out && Array.isArray(out.groups) ? out.groups : []);
      for (const it of arr) { const r = chunk.find(x => String(x["Topic"]).toLowerCase() === String(it.topic || "").toLowerCase()); if (r && it.review) S.topicReviews[r["Topic"]] = String(it.review).slice(0, 800); }
      await saveLocal(K.topics(), S.topicReviews);
      done += chunk.length; renderTopics();
    }
  } finally {
    S.cn.ctl = null; $("cn-stop").hidden = true;
    $("cn-progress").textContent = failed || (ctl.signal.aborted ? "Stopped." : `Reviewed ${done} topic group${done === 1 ? "" : "s"}.`);
    renderTopics();
  }
}

// ---------- header + empty states ----------
function renderBrand() {
  const d = siteDomain();
  $("brand-mark").textContent = d ? (brandName()[0] || "C").toUpperCase() : "C";
  $("brand-sub").textContent = d ? `${d} · ${S.meta ? (S.meta.mode === "gsc" ? "Search Console (last 3 months)" : "Moz ranking keywords") + (S.meta.sources && S.meta.sources.some(s => /^GA4/.test(s)) ? " + GA4" : "") : "Moz ranking keywords"} + Moz API` : "Moz API · bring your own key";
  document.querySelectorAll("[data-site]").forEach(el => el.textContent = d || "your site");
  $("rebuild-btn").hidden = !d; $("xlsx-btn").hidden = !S.data;
}
function showEmpty(kind, msg) {
  const box = $("loading"); box.hidden = false;
  ROUTES.filter(x => x !== "settings").forEach(x => $("view-" + x).hidden = true);
  if (kind === "loading") { box.innerHTML = `<div class="spinner" aria-hidden="true"></div><strong>Opening your library…</strong>`; return; }
  if (kind === "building") { box.innerHTML = `<div class="spinner" aria-hidden="true"></div><strong>Building the library for ${esc(siteDomain())}</strong><span class="muted small" id="loading-detail">${esc(msg || "")}</span>`; return; }
  const settingsReady = !settingsMissing().length;
  box.innerHTML = kind === "error"
    ? `<strong>The library couldn't be built</strong><span class="muted small" style="max-width:640px">${esc(msg)}</span><div class="filter-row" style="justify-content:center"><button class="btn primary" type="button" data-build>Try again</button><a class="btn" href="#settings">Open Settings</a></div>`
    : settingsReady
      ? `<strong>No library for ${esc(siteDomain())} yet</strong><span class="muted small" style="max-width:640px">Building it indexes your site, reads your Search Console and GA4 file if you uploaded one, pulls the keywords you rank for from Moz, then finds every keyword where more than one of your pages competes. It takes 2–5 minutes and is saved in this browser.</span><div class="filter-row" style="justify-content:center"><button class="btn primary" type="button" data-build>Build the library</button><a class="btn" href="#settings">Review settings first</a></div>`
      : `<strong>Start in Settings</strong><span class="muted small" style="max-width:640px">Add your Moz API token and your site's domain, and upload your Search Console and GA4 export for the most accurate results. Everything stays in your browser.</span><div class="filter-row" style="justify-content:center"><a class="btn primary" href="#settings">Open Settings</a></div>`;
  box.querySelectorAll("[data-build]").forEach(b => b.onclick = buildLib);
}

// ---------- routing ----------
const ROUTES = ["library", "cannibalized", "topic-check", "settings"];
function route() {
  let r = location.hash.replace("#", "");
  if (r.startsWith("settings-")) { const why = r.slice(9); r = "settings"; history.replaceState(null, "", "#settings"); googleNotice(why); }
  if (!ROUTES.includes(r)) r = "library";
  document.querySelectorAll("nav.tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.tab === r ? "page" : "false"));
  if (r === "settings") { ROUTES.forEach(x => $("view-" + x).hidden = x !== r); $("loading").hidden = true; renderSettings(); return; }
  $("view-settings").hidden = true;
  if (S.building) { showEmpty("building", S.buildMsg); return; }
  if (!S.data) { showEmpty(S.buildError ? "error" : "empty", S.buildError); return; }
  $("loading").hidden = true;
  ROUTES.forEach(x => $("view-" + x).hidden = x !== r);
  if (r === "library") renderLibrary();
  if (r === "cannibalized") renderCn();
  if (r === "topic-check") ensureTopicCheck();
}
window.addEventListener("hashchange", route);
function googleNotice(why) {
  const m = { "google-cancelled": "Google sign-in was cancelled.", "google-state": "Google sign-in expired. Try connecting again.", "google-failed": "Google didn't return access. Try again, and make sure you tick the Search Console and Analytics boxes.", "google-not-configured": "Google sign-in isn't set up on this deployment yet." }[why];
  if (m) toast(m);
}

// ---------- settings ----------
const googleReady = () => !!(S.google && S.google.connected && CFG.gscSite);
const useGoogle = () => !CFG.mozOnly && googleReady();
function settingsMissing() { return [!CFG.mozOnly && !googleReady() && (S.google && S.google.connected ? "a Search Console property" : "Google sign-in"), !CFG.moz && !S.mock && "Moz API token", !siteDomain() && "your site's domain"].filter(Boolean); }
const domainFromGsc = (u) => String(u || "").replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
function renderHeadGoogle() {
  const el = $("g-head"), g = S.google; if (!el) return;
  if (!g || !g.configured) { el.hidden = true; return; }
  el.hidden = false;
  if (g.connected) { el.textContent = g.email ? `Google: ${g.email}` : "Google connected"; el.href = "#settings"; }
  else { el.textContent = "Sign in with Google"; el.href = "/api/google/login"; }
}
function updateStatus() {
  const miss = settingsMissing();
  if (S.building) setStatus("busy", "Building the library…");
  else if (miss.length) setStatus("busy", "Settings needed: " + esc(miss.join(", ")));
  else if (S.data) { const age = (Date.now() - new Date(S.loadedAt)) / 864e5; setStatus(age > 35 ? "busy" : "ok", statusLine() + (age > 35 ? " · over a month old, rebuild" : "")); }
  else setStatus("busy", `${esc(siteDomain())} · no library yet`);
  syncClaude(); renderBrand();
}
function renderSettings() {
  $("s-moz").value = CFG.moz; $("s-claude").value = CFG.claude; $("s-domain").value = CFG.domain; $("s-brand").value = CFG.brand;
  $("s-sections").value = CFG.sections || ""; $("s-remember").checked = !!CFG.remember; $("s-mozonly").checked = !!CFG.mozOnly;
  const sel = $("s-model");
  if (CFG.model && ![...sel.options].some(o => o.value === CFG.model)) sel.innerHTML = `<option value="${esc(CFG.model)}">${esc(CFG.model)}</option>` + sel.innerHTML;
  sel.value = CFG.model || "";
  renderSizes(); renderRows(); renderSite(); renderGoogle(); renderDataBox(); renderUploads(); updateStatus();
  if (!S.site && siteDomain()) refreshSite();
  if (!S.google) refreshGoogle();
}
async function loadModels() {
  const sel = $("s-model"), btn = $("s-models");
  if (!CFG.claude && !S.mock) { toast("Paste your Claude API key first."); return; }
  btn.disabled = true; btn.textContent = "Loading…";
  try {
    const { models } = await api("models");
    const pref = (m) => /opus/i.test(m.id) ? 0 : /sonnet/i.test(m.id) ? 1 : 2;
    const list = models.slice().sort((a, b) => pref(a) - pref(b));
    sel.innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.id)})</option>`).join("");
    if (!CFG.model || !list.some(m => m.id === CFG.model)) CFG.model = (list.find(m => /sonnet/i.test(m.id)) || list[0] || {}).id || "";
    sel.value = CFG.model; saveSettings(); updateStatus();
    toast(`${list.length} models available.`);
  } catch (e) { $("s-msg").textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = "Load models"; }
}
async function refreshSite() {
  const d = siteDomain(); if (!d) { S.site = null; renderSite(); return; }
  try { S.site = await api("site?domain=" + encodeURIComponent(d)); } catch (e) { S.site = { error: e.message }; }
  renderSite();
}
const SIZE_INFO = { 500: "2–4 min", 1000: "5–8 min", 2500: "12–20 min", 5000: "25–40 min" };
function renderSizes() {
  const cur = Number(CFG.size) || 1000;
  $("s-sizes").innerHTML = `<table class="mini"><thead><tr><th></th><th>Pages</th><th>Time to finish</th><th>Moz API</th><th>Claude API</th></tr></thead><tbody>${[500, 1000, 2500, 5000].map(n => `<tr><td><input type="radio" name="s-size" value="${n}" ${n === cur ? "checked" : ""} aria-label="${n} pages"></td><td><b>${fmt(n)}</b></td><td>${SIZE_INFO[n]}</td><td>about 200 rows</td><td>none</td></tr>`).join("")}</tbody></table>
  <p class="hint">The crawl reads your public pages (sitemap first, respects robots.txt), so every size costs the same: one Moz look-up of your top ranking pages to crawl them first, reused for 30 days. The library can be built once 300 pages are in; the rest keeps indexing while this page is open and overnight. Pages that rank are always in the library, indexed or not.</p>`;
  document.querySelectorAll('input[name="s-size"]').forEach(r => r.onchange = () => { CFG.size = Number(r.value); saveSettings(); renderSite(); });
}
function renderRows() {
  const cur = Number(CFG.mozRows) || 1000;
  $("s-rows").innerHTML = `<table class="mini"><thead><tr><th></th><th>Ranking keywords from Moz</th><th>Moz API per build</th></tr></thead><tbody>${[500, 1000, 2500, 5000].map(n => `<tr><td><input type="radio" name="s-rows" value="${n}" ${n === cur ? "checked" : ""} aria-label="${n} keywords"></td><td><b>${fmt(n)}</b> (by search volume)</td><td>up to ${fmt(n)} rows</td></tr>`).join("")}</tbody></table>`;
  document.querySelectorAll('input[name="s-rows"]').forEach(r => r.onchange = () => { CFG.mozRows = Number(r.value); saveSettings(); renderCost(); });
  $("s-vol").value = String(CFG.volumeLimit ?? 200);
  renderCost();
}
function renderCost() {
  const g = useGoogle() || !!(S.up && S.up.gsc);
  const rows = Number(CFG.mozRows) || 1000, vol = g ? Number(CFG.volumeLimit) || 0 : 0;
  $("s-cost").innerHTML = `<b>Estimated cost of one build</b>
    <div class="small">Moz API: up to <b>${fmt(rows + vol * 5)} rows</b> (${fmt(rows)} ranking keywords${g ? ` + search volume for up to ${fmt(vol)} Search Console keywords at up to 5 rows each` : ""}). Your plan's quota is shown in the Moz API dashboard.</div>
    <div class="small">${g ? "Search Console and GA4 data: free. " : ""}Claude: none to build. Asking Claude to review costs one request per 5 keywords or 8 topic groups on your Anthropic account, usually a few cents each.</div>`;
}
function renderSite() {
  const el = $("s-site"), s = S.site;
  if (!siteDomain()) { el.innerHTML = '<span class="muted small">Enter your domain above.</span>'; $("s-index").hidden = true; return; }
  $("s-index").hidden = false;
  if (!s) { el.innerHTML = '<span class="muted small">Checking…</span>'; return; }
  if (s.error) { el.innerHTML = `<span class="src-bad small">${esc(s.error)}</span>`; return; }
  const parts = [];
  if (s.ready) parts.push(`<span class="pill ${s.fresh ? "good" : "warn"}">${fmt(s.pages)} pages indexed${s.partial ? " so far" : ""}</span> <span class="small muted">${s.partial ? "usable now, still indexing" : `crawled ${esc(String(s.crawledAt || "").slice(0, 10))}`}${s.cap ? ` · size ${fmt(s.cap)}` : ""}${(s.sections || []).length ? ` · sections ${esc(s.sections.join(", "))}` : ""}${s.fresh || s.partial ? "" : " · over 30 days old, re-index"}</span>`);
  else parts.push('<span class="pill warn">Not indexed yet</span> <span class="small muted">Building the library indexes it first.</span>');
  if (s.crawling) parts.push(`<span class="progress"><span class="spinner"></span>${S.indexing ? "Indexing" : "Indexing paused (continues while this page is open, or tonight)"}: ${fmt(s.crawling.done)} of ${fmt(s.crawling.total)} URLs checked, ${fmt(s.crawling.pages)} pages kept</span>`);
  if (s.failed) parts.push(`<span class="src-bad small">${esc(s.failed)}</span>`);
  el.innerHTML = parts.join("<br>");
  const want = Number(CFG.size) || 1000, cur = s.cap || 0;
  $("s-index").textContent = s.crawling && !S.indexing ? "Continue indexing" : s.ready && cur === want ? "Re-index now" : s.ready ? `Re-index at ${fmt(want)} pages` : `Index my site (${fmt(want)} pages)`;
  $("s-index").disabled = !!S.indexing;
}
function indexSite(onProgress, opts = {}) {
  const d = siteDomain(); if (!d) return Promise.reject(new ApiError("Enter your site's domain in Settings.", "no_domain"));
  const waitFor = (cond) => new Promise((resolve, reject) => {
    const check = () => { const s = S.site; if (s && cond(s)) return resolve(s); if (S.indexError) return reject(S.indexError); if (!S.indexing) return s && s.ready ? resolve(s) : reject(new ApiError("Indexing stopped.", "crawl_stopped")); setTimeout(check, 800); };
    check();
  });
  if (!S.indexing) {
    S.indexError = null;
    let first = !!opts.restart;
    S.indexing = (async () => {
      try {
        for (let i = 0; i < 400; i++) {
          const s = await api("site", { domain: d, cap: Number(CFG.size) || 1000, sections: CFG.sections || "", restart: first });
          first = false; S.site = s; renderSite();
          if (onProgress) onProgress(s);
          if (s.failed && !s.ready) throw new ApiError(s.failed, "crawl_failed");
          if (s.ready && !s.crawling) return s;
        }
      } catch (e) { S.indexError = e; throw e; }
      finally { S.indexing = null; renderSite(); }
    })();
    S.indexing.catch(() => {});
  }
  return opts.untilUsable ? waitFor(s => s.ready) : waitFor(s => s.ready && !s.crawling);
}

// ---------- Google (Search Console + GA4), optional ----------
const GOOGLE_ENABLED = false; // Google sign-in (Search Console + GA4) is built but switched off: the library runs on Moz data.
async function refreshGoogle() {
  if (!GOOGLE_ENABLED) { S.google = { configured: false }; renderHeadGoogle(); renderCost(); return; }
  try { S.google = await api("google/status"); } catch (e) { S.google = { error: e.message }; }
  const g = S.google;
  if (g && g.connected) {
    const d = siteDomain();
    if (!CFG.gscSite && d && g.sites) { const m = g.sites.find(s => s.siteUrl === "sc-domain:" + d) || g.sites.find(s => s.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") === d); if (m) { CFG.gscSite = m.siteUrl; saveSettings(); } }
    if (CFG.gscSite && g.sites && !g.sites.some(s => s.siteUrl === CFG.gscSite)) { CFG.gscSite = ""; saveSettings(); }
    if (!CFG.gscSite && g.sites && g.sites.length === 1) { CFG.gscSite = g.sites[0].siteUrl; saveSettings(); }
    if (CFG.gscSite && !siteDomain()) { CFG.domain = domainFromGsc(CFG.gscSite); saveSettings(); refreshSite(); openLibrary(); }
    pickGa4();
  }
  renderGoogle(); renderCost(); renderHeadGoogle(); updateStatus();
}
function pickGa4() {
  const g = S.google, d = siteDomain(); if (!g || !g.properties || CFG.ga4Property || CFG.ga4Skip || !d) return;
  const root = d.split(".")[0];
  const m = g.properties.find(p => p.name.toLowerCase().includes(d)) || g.properties.find(p => p.name.toLowerCase().includes(root)) || (g.properties.length === 1 ? g.properties[0] : null);
  if (m) { CFG.ga4Property = m.id; saveSettings(); }
}
function renderGoogle() {
  const el = $("g-box"), g = S.google;
  if (!g) { el.innerHTML = '<span class="muted small">Checking…</span>'; return; }
  if (g.error) { el.innerHTML = `<span class="src-bad small">${esc(g.error)}</span> <button class="btn small" type="button" id="g-retry">Try again</button>`; $("g-retry").onclick = () => { S.google = null; renderGoogle(); refreshGoogle(); }; return; }
  if (!g.configured) { el.innerHTML = `<p class="small" style="margin:0"><span class="pill warn">Google sign-in is being set up</span> Until it's ready, you can build with Moz data only (tick the box below).</p>`; return; }
  if (!g.connected) {
    el.innerHTML = `<div class="filter-row"><a class="btn primary" href="/api/google/login">Sign in with Google</a></div><p class="hint">Read-only access to Search Console and Google Analytics. Your sign-in stays in an encrypted cookie in this browser, and you can disconnect any time.</p>`;
    return;
  }
  const sites = g.sites || [], props = g.properties || [];
  el.innerHTML = `<div class="small">Connected as <b>${esc(g.email || "your Google account")}</b> <button class="btn small" type="button" id="g-logout">Disconnect</button></div>
    <div class="field"><label for="s-gsc">Search Console property</label><select id="s-gsc"><option value="">Choose your property</option>${sites.map(s => `<option value="${esc(s.siteUrl)}">${esc(s.siteUrl)}</option>`).join("")}</select>
      <span class="hint">${g.sitesError ? `<span class="src-bad">${esc(g.sitesError)}</span>` : sites.length ? "Query → page data for the last 3 months: shows every page that appears for a keyword, with clicks and impressions." : "No verified Search Console properties on this account."}</span></div>
    <div class="field"><label for="s-ga4">GA4 property</label><select id="s-ga4"><option value="">Skip GA4</option>${props.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.account)} (${esc(p.id)})</option>`).join("")}</select>
      <span class="hint">${g.propertiesError ? `<span class="src-bad">${esc(g.propertiesError)}</span>` : "Adds sessions per page for the last 12 months to the library."}</span></div>`;
  $("s-gsc").value = CFG.gscSite || ""; $("s-ga4").value = CFG.ga4Property || "";
  $("s-gsc").onchange = () => {
    CFG.gscSite = $("s-gsc").value; const d = domainFromGsc(CFG.gscSite);
    if (d && d !== siteDomain()) { CFG.domain = d; CFG.ga4Property = ""; CFG.ga4Skip = false; $("s-domain").value = d; S.site = null; refreshSite(); openLibrary(); pickGa4(); renderGoogle(); }
    saveSettings(); renderCost(); updateStatus();
  };
  $("s-ga4").onchange = () => { CFG.ga4Property = $("s-ga4").value; CFG.ga4Skip = !CFG.ga4Property; saveSettings(); };
  $("g-logout").onclick = async () => { try { await fetch("/api/google/logout", { method: "POST" }); } catch (e) {} CFG.gscSite = ""; CFG.ga4Property = ""; CFG.ga4Skip = false; saveSettings(); S.google = null; renderGoogle(); refreshGoogle(); toast("Google disconnected."); };
}

// ---------- stored library ----------
function renderDataBox() {
  const el = $("s-data");
  if (!siteDomain()) { el.innerHTML = '<span class="muted small">Enter your domain first.</span>'; return; }
  if (!S.data) { el.innerHTML = `<span class="small muted">No library saved for ${esc(siteDomain())} in this browser yet.</span>`; return; }
  const m = S.meta || {};
  el.innerHTML = `<div class="small"><b>${fmt(S.inv.length)} URLs · ${fmt(S.libRows.length)} keywords · ${fmt(S.kwGroups.length)} cannibalized · ${fmt(S.ov.length)} topic groups</b></div>
    <div class="small muted">Built ${esc(new Date(S.loadedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))} from ${esc((m.sources || []).join(" · "))}</div>
    <div class="filter-row"><button class="btn small" type="button" id="s-xlsx">Download .xlsx</button><button class="btn small" type="button" id="s-clear">Delete from this browser</button></div>`;
  $("s-xlsx").onclick = downloadXlsx;
  $("s-clear").onclick = async () => { await Promise.all([IDB.del(K.lib()), IDB.del(K.reviews()), IDB.del(K.checks()), IDB.del(K.topics()), IDB.del(K.up())]); S.data = null; S.meta = null; S.reviews = new Map(); S.checks = []; S.topicReviews = {}; S.up = {}; renderDataBox(); renderUploads(); updateStatus(); toast("Library, uploaded files, reviews and checks deleted from this browser."); };
}
function bindSettings() {
  const upd = () => {
    const before = siteDomain();
    CFG.moz = $("s-moz").value.trim(); CFG.claude = $("s-claude").value.trim(); CFG.domain = $("s-domain").value.trim(); CFG.brand = $("s-brand").value.trim();
    CFG.sections = $("s-sections").value.trim(); CFG.model = $("s-model").value; CFG.remember = $("s-remember").checked;
    CFG.volumeLimit = Number($("s-vol").value) || 0; CFG.mozOnly = $("s-mozonly").checked;
    saveSettings();
    if (siteDomain() !== before) { S.site = null; if (domainFromGsc(CFG.gscSite) !== siteDomain()) { CFG.gscSite = ""; CFG.ga4Property = ""; CFG.ga4Skip = false; } saveSettings(); refreshSite(); refreshGoogle(); openLibrary(); }
    updateStatus(); renderCost();
  };
  ["s-moz", "s-claude", "s-domain", "s-brand", "s-sections", "s-model", "s-remember", "s-vol", "s-mozonly"].forEach(id => $(id).addEventListener("change", upd));
  $("s-models").onclick = () => { upd(); loadModels(); };
  $("s-index").onclick = async () => {
    upd(); const s = S.site || {};
    const restart = !(s.crawling && !S.indexing) && (!!s.ready || !!s.crawling);
    try { await indexSite(null, { restart }); toast("Site indexed."); } catch (e) { $("s-msg2").textContent = e.message; }
  };
  $("s-build").onclick = () => { upd(); buildLib(); };
  $("s-upload").onchange = (e) => { onUpload(e.target.files); e.target.value = ""; };
  $("s-forget").onclick = () => { CFG.moz = ""; CFG.claude = ""; CFG.remember = false; try { sessionStorage.removeItem(SKEY); } catch (e) {} saveSettings(); renderSettings(); toast("Keys removed from this browser."); };
}

// ---------- your own data: Search Console / GA4 exports, or a whole library ----------
const hnorm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const colOf = (h, names) => h.findIndex(x => names.includes(x));
const GSC_Q = ["query", "queries", "top queries", "search query", "keyword", "keywords"], GSC_P = ["page", "pages", "url", "landing page", "top pages", "address"];
const GA_P = ["pagepath", "page path", "page path and screen class", "landingpage", "landing page", "landing page query string", "pagelocation", "page location", "page", "url"];
function headerRow(aoa, test) { for (let i = 0; i < Math.min(aoa.length, 40); i++) { const h = (aoa[i] || []).map(hnorm); const m = test(h); if (m) return { i, m }; } return null; }
const pathOfUrl = (u) => { let s = String(u || "").trim(); try { if (/^https?:/i.test(s)) s = new URL(s).pathname; } catch (e) {} s = s.split(/[?#]/)[0].replace(/\/+$/, ""); return s || "/"; };
const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } };
const LIB_TABS = { inv: "URL Inventory", lib: "Cannibalization Library", ov: "Topic Overlaps", ku: "Keyword URLs" };
function tableOf(aoa) {
  const head = (aoa[0] || []).map(h => String(h ?? "").trim()); let last = head.length; while (last > 0 && !head[last - 1]) last--;
  const cols = head.slice(0, last);
  return { cols, rows: aoa.slice(1).filter(r => r.some(c => c !== "" && c != null)).map(r => cols.map((_, i) => { const v = r[i]; return v == null ? "" : typeof v === "number" ? v : String(v); })) };
}
async function readUploads(files) {
  await loadXlsxLib();
  const found = { gsc: null, ga4: null, lib: null }, notes = [];
  for (const file of files) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const names = wb.SheetNames;
    if (names.includes(LIB_TABS.inv) && (names.includes(LIB_TABS.ku) || names.includes(LIB_TABS.lib))) {
      const data = {}; for (const [k, n] of Object.entries(LIB_TABS)) data[k] = names.includes(n) ? tableOf(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" })) : { cols: [], rows: [] };
      found.lib = { data, name: file.name }; continue;
    }
    for (const n of names) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
      const g = headerRow(aoa, h => { const q = colOf(h, GSC_Q), p = colOf(h, GSC_P), c = colOf(h, ["clicks"]), im = colOf(h, ["impressions", "impr"]), pos = colOf(h, ["position", "avg position", "average position", "avg pos"]); return q >= 0 && p >= 0 && c >= 0 && im >= 0 && pos >= 0 ? { q, p, c, im, pos } : null; });
      if (g) {
        const { q, p, c, im, pos } = g.m; const rows = found.gsc ? found.gsc.rows : [];
        for (const r of aoa.slice(g.i + 1)) { const ps = num(r[pos]); if (!r[q] || !r[p] || ps == null || ps > 20) continue; rows.push([String(r[q]).trim(), String(r[p]).trim(), num(r[c]) || 0, num(r[im]) || 0, Math.round(ps * 10) / 10]); }
        found.gsc = { rows, name: (found.gsc ? found.gsc.name + ", " : "") + `${file.name} › ${n}` }; continue;
      }
      const a = headerRow(aoa, h => { const p = colOf(h, GA_P), s = colOf(h, ["sessions"]); return p >= 0 && s >= 0 ? { p, s } : null; });
      if (a) {
        const m = new Map(found.ga4 ? found.ga4.rows : []);
        for (const r of aoa.slice(a.i + 1)) { if (!r[a.m.p] || /^(total|grand total)/i.test(String(r[a.m.p]))) continue; const k = pathOfUrl(r[a.m.p]); m.set(k, (m.get(k) || 0) + (num(r[a.m.s]) || 0)); }
        found.ga4 = { rows: [...m.entries()], name: (found.ga4 ? found.ga4.name + ", " : "") + `${file.name} › ${n}` }; continue;
      }
      if (aoa.length > 1) notes.push(`${file.name} › ${n}`);
    }
  }
  return { found, notes };
}
async function onUpload(files) {
  const msg = (t, bad) => { $("s-uploads").innerHTML = `<span class="small ${bad ? "src-bad" : "muted"}">${esc(t)}</span>`; };
  if (!files.length) return;
  msg("Reading your file…");
  let res; try { res = await readUploads([...files]); } catch (e) { msg("Couldn't read that file: " + (e.message || e), true); return; }
  const { found, notes } = res;
  if (found.lib) {
    const inv = found.lib.data.inv, ui = inv.cols.indexOf("URL");
    const hosts = new Map(); inv.rows.forEach(r => { const h = hostOf(r[ui]); if (h) hosts.set(h, (hosts.get(h) || 0) + 1); });
    const host = [...hosts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (host && host[0] !== siteDomain()) { CFG.domain = host[0]; saveSettings(); $("s-domain").value = CFG.domain; S.site = null; refreshSite(); }
    const ci = inv.cols.indexOf("Clicks (3 mo)");
    const rec = { data: found.lib.data, meta: { domain: siteDomain(), builtAt: new Date().toISOString(), mode: ci >= 0 && inv.rows.some(r => r[ci] !== "") ? "gsc" : "moz", sources: [`Uploaded library (${found.lib.name})`] }, loadedAt: new Date().toISOString() };
    await saveLocal(K.lib(), rec); await loadLocal();
    S.meta = rec.meta; tcIndex = null; tcInit = false; applyData(rec.data, rec.loadedAt, "upload");
    renderDataBox(); updateStatus(); renderUploads();
    toast(`Library loaded: ${fmt(inv.rows.length)} URLs.`); return;
  }
  if (!found.gsc && !found.ga4) { msg("No Search Console or GA4 data found. Search Console needs Query, Page, Clicks, Impressions and Position columns; GA4 needs a page path column and Sessions." + (notes.length ? " Sheets checked: " + notes.join(", ") + "." : ""), true); return; }
  if (found.gsc && !siteDomain()) {
    const hosts = new Map(); found.gsc.rows.forEach(r => { const h = hostOf(r[1]); if (h) hosts.set(h, (hosts.get(h) || 0) + 1); });
    const host = [...hosts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (host) { CFG.domain = host[0]; saveSettings(); $("s-domain").value = CFG.domain; refreshSite(); await openLibrary(); }
  }
  if (found.gsc) S.up.gsc = found.gsc;
  if (found.ga4) S.up.ga4 = found.ga4;
  await saveLocal(K.up(), S.up);
  renderUploads(); renderCost(); updateStatus();
  toast("Saved in this browser. Build the library to use it.");
}
function renderUploads() {
  const el = $("s-uploads"); if (!el) return;
  const u = S.up || {}, parts = [];
  if (u.gsc) parts.push(`<div class="small"><span class="pill good">Search Console</span> ${fmt(u.gsc.rows.length)} query × page rows (positions 1–20) from ${esc(u.gsc.name)} <button class="btn small" type="button" data-rm="gsc">Remove</button></div>`);
  if (u.ga4) parts.push(`<div class="small"><span class="pill good">GA4</span> sessions for ${fmt(u.ga4.rows.length)} pages from ${esc(u.ga4.name)} <button class="btn small" type="button" data-rm="ga4">Remove</button></div>`);
  el.innerHTML = parts.join("") || '<span class="small muted">No file yet. Without one, the library uses Moz data only.</span>';
  el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { delete S.up[b.dataset.rm]; await saveLocal(K.up(), S.up); renderUploads(); renderCost(); });
}

// ---------- build the library ----------
async function buildLib() {
  if (S.building) return;
  const d = siteDomain();
  const miss = settingsMissing();
  if (miss.length) { toast("Before building: " + miss.join(", ") + "."); location.hash = "#settings"; return; }
  S.building = true; S.buildError = null; $("s-build").disabled = true; $("rebuild-btn").disabled = true;
  const t0 = Date.now();
  const say = (m) => { S.buildMsg = m; const el = $("loading-detail"); if (el) el.textContent = m; $("s-build-msg").textContent = m; };
  const onLib = !location.hash.startsWith("#settings");
  if (onLib) showEmpty("building", "Starting…");
  updateStatus();
  let tick;
  try {
    if (!S.site) await refreshSite();
    if (!(S.site && S.site.ready)) {
      say("Indexing your site (titles and publish dates for every page)…");
      await indexSite(s => say(`Indexing your site: ${fmt(s.crawling ? s.crawling.pages : s.pages)} pages kept so far. The library is built once 300 are in.`), { untilUsable: true });
    }
    const useG = useGoogle();
    const steps = [(useG && CFG.gscSite) || (S.up && S.up.gsc) ? "Search Console" : null, (useG && CFG.ga4Property) || (S.up && S.up.ga4) ? "GA4" : null, "Moz ranking keywords"].filter(Boolean).join(", ");
    tick = setInterval(() => say(`Reading ${steps} and finding pages that compete… ${Math.round((Date.now() - t0) / 1000)}s (usually 1–3 minutes)`), 1000);
    const up = S.up || {};
    const { library } = await api("library", {
      gscUpload: up.gsc ? { rows: up.gsc.rows, name: up.gsc.name } : undefined, ga4Upload: up.ga4 ? { rows: up.ga4.rows, name: up.ga4.name } : undefined,
      domain: d, brandTerms: listOf(CFG.brand).length ? listOf(CFG.brand) : [d.split(".")[0]], include: listOf(CFG.sections),
      mozRows: Number(CFG.mozRows) || 1000, volumeLimit: Number(CFG.volumeLimit) || 0,
      gscSite: useG ? CFG.gscSite : "", ga4Property: useG ? CFG.ga4Property || "" : "",
    }, { gzip: !!(up.gsc || up.ga4) });
    clearInterval(tick);
    const data = { inv: library.inv, lib: library.lib, ov: library.ov, ku: library.ku };
    const rec = { data, meta: library.meta, loadedAt: library.meta.builtAt };
    await saveLocal(K.lib(), rec);
    S.meta = rec.meta; tcIndex = null; tcInit = false;
    S.building = false;
    applyData(data, rec.loadedAt, "built");
    say(""); toast(`Library built: ${fmt(library.meta.cannibalized)} cannibalized keywords across ${fmt(library.meta.urls)} URLs.`);
    if (location.hash.startsWith("#settings")) renderDataBox();
  } catch (e) {
    clearInterval(tick);
    S.buildError = e.message || String(e); say(""); $("s-build-msg").textContent = S.buildError;
  } finally {
    S.building = false; $("s-build").disabled = false; $("rebuild-btn").disabled = false;
    updateStatus(); route();
  }
}

// ---------- Excel download ----------
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = () => rej(new Error("The spreadsheet library didn't load.")); document.head.appendChild(s); });
}
async function downloadXlsx() {
  if (!S.data) return;
  try {
    await loadXlsxLib();
    const wb = XLSX.utils.book_new();
    const add = (t, name, extra) => { const cols = t.cols.concat(extra ? [extra.col] : []); const rows = t.rows.map((r, i) => extra ? r.concat([extra.val(i)]) : r); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...rows]), name); };
    add(S.data.inv, "URL Inventory");
    add(S.data.lib, "Cannibalization Library");
    const ti = S.data.ov.cols.indexOf("Topic");
    add(S.data.ov, "Topic Overlaps", { col: "Claude review", val: (i) => S.topicReviews[S.data.ov.rows[i][ti]] || "" });
    add(S.data.ku, "Keyword URLs");
    const rv = [["Keyword", "Summary", "URL", "Action", "Recommendation", "Reviewed"]];
    S.reviews.forEach(r => (r.urls || []).forEach(u => rv.push([r.keyword, r.summary, u.url, u.action, u.recommendation, r.reviewedAt])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rv), "Claude reviews");
    const m = S.meta || {};
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Domain", siteDomain()], ["Built", S.loadedAt], ["Sources", (m.sources || []).join(" · ")]]), "About");
    XLSX.writeFile(wb, `${siteDomain()}-cannibalization-library-${String(S.loadedAt).slice(0, 10)}.xlsx`);
  } catch (e) { toast(e.message || "Couldn't create the file."); }
}

// ---------- boot ----------
async function openLibrary() {
  S.data = null; S.meta = null; tcIndex = null; tcInit = false; tcLast = null;
  if (!siteDomain()) { updateStatus(); route(); return; }
  showEmpty("loading");
  const rec = await IDB.get(K.lib());
  await loadLocal();
  if (rec && rec.data) { S.meta = rec.meta || null; applyData(rec.data, rec.loadedAt, "saved"); }
  updateStatus(); route();
}
$("rebuild-btn").onclick = buildLib;
$("xlsx-btn").onclick = downloadXlsx;
function applyDemo() {
  $("demo-btn").setAttribute("aria-pressed", String(DEMO));
  $("demo-btn").textContent = DEMO ? "Demo mode: on" : "Demo mode";
  $("demo-pill").hidden = !DEMO;
}
$("demo-btn").onclick = () => {
  DEMO = !DEMO;
  try { localStorage.setItem("ccDemo", DEMO ? "1" : "0"); } catch (e) {}
  applyDemo(); route();
  if (tcLast) renderCheck(tcLast);
  renderHistory();
  const cb = document.getElementById("tc-claude"); if (cb && DEMO) cb.innerHTML = "";
};
(async () => {
  try { const h = await fetch("/api/health").then(r => r.ok ? r.json() : {}); S.mock = !!h.mock; } catch (e) {}
  applyDemo(); bindSettings(); updateStatus();
  await openLibrary();
  refreshGoogle();
  if (siteDomain()) refreshSite();
})();
})();
