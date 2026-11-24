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
  return { moz: "", claude: "", model: "", domain: "", brand: "", exclude: "", sections: "", size: 1000, mozRows: 1000, volumeLimit: 200, gscSite: "", ga4Property: "", ga4Skip: false, mozOnly: false, remember: false, ...s };
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
  const res = await fetch("/api/" + path, { method: payload === undefined ? "GET" : "POST", headers, body: payload === undefined ? undefined : JSON.stringify(payload), signal: opts.signal, credentials: "same-origin" });
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
const K = { lib: () => "lib:" + siteDomain(), reviews: () => "reviews:" + siteDomain(), checks: () => "checks:" + siteDomain(), topics: () => "topicReviews:" + siteDomain() };

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
  readOnly: false, site: null, google: null, building: false,
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
  const [rv, ch, tp] = await Promise.all([IDB.get(K.reviews()), IDB.get(K.checks()), IDB.get(K.topics())]);
  S.reviews = new Map((rv || []).map(v => [docId(v.keyword), v]));
  S.checks = Array.isArray(ch) ? ch : [];
  S.topicReviews = tp && typeof tp === "object" ? tp : {};
}
const saveReviews = () => saveLocal(K.reviews(), [...S.reviews.values()]);
