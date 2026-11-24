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
  $("brand-sub").textContent = d ? `${d} · ${S.meta && S.meta.mode === "gsc" ? "Search Console (last 3 months)" : "Moz ranking keywords"}${S.meta && S.meta.sources && S.meta.sources.some(s => /^GA4/.test(s)) ? " + GA4" : ""} + Moz API` : "Bring your own Moz and Claude keys · optional Google Search Console and GA4";
  document.querySelectorAll("[data-site]").forEach(el => el.textContent = d || "your site");
  $("rebuild-btn").hidden = !d; $("xlsx-btn").hidden = !S.data;
}
function showEmpty(kind, msg) {
  const box = $("loading"); box.hidden = false;
  ROUTES.filter(x => x !== "settings").forEach(x => $("view-" + x).hidden = true);
  if (kind === "loading") { box.innerHTML = `<div class="spinner" aria-hidden="true"></div><strong>Opening your library…</strong>`; return; }
  if (kind === "building") { box.innerHTML = `<div class="spinner" aria-hidden="true"></div><strong>Building the library for ${esc(siteDomain())}</strong><span class="muted small" id="loading-detail">${esc(msg || "")}</span>`; return; }
  const settingsReady = !!siteDomain() && (!!CFG.moz || S.mock);
  box.innerHTML = kind === "error"
    ? `<strong>The library couldn't be built</strong><span class="muted small" style="max-width:640px">${esc(msg)}</span><div class="filter-row" style="justify-content:center"><button class="btn primary" type="button" data-build>Try again</button><a class="btn" href="#settings">Open Settings</a></div>`
    : settingsReady
      ? `<strong>No library for ${esc(siteDomain())} yet</strong><span class="muted small" style="max-width:640px">Building it indexes your site, pulls the keywords it ranks for from Moz (and Search Console if you connected Google), then finds every keyword where more than one of your pages competes. It takes 2–5 minutes and is saved in this browser.</span><div class="filter-row" style="justify-content:center"><button class="btn primary" type="button" data-build>Build the library</button><a class="btn" href="#settings">Review settings first</a></div>`
      : `<strong>Start in Settings</strong><span class="muted small" style="max-width:640px">Add your Moz API token and your site's domain. Connecting Google Search Console is optional but gives the most accurate picture: real clicks and impressions for every page that shows for a keyword.</span><div class="filter-row" style="justify-content:center"><a class="btn primary" href="#settings">Open Settings</a></div>`;
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
function settingsMissing() { return [!CFG.moz && !S.mock && "Moz API token", !siteDomain() && "your site's domain"].filter(Boolean); }
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
  $("s-exclude").value = CFG.exclude || ""; $("s-sections").value = CFG.sections || ""; $("s-remember").checked = !!CFG.remember;
  const sel = $("s-model");
  if (CFG.model && ![...sel.options].some(o => o.value === CFG.model)) sel.innerHTML = `<option value="${esc(CFG.model)}">${esc(CFG.model)}</option>` + sel.innerHTML;
  sel.value = CFG.model || "";
  renderSizes(); renderRows(); renderSite(); renderGoogle(); renderDataBox(); updateStatus();
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
  const g = !!(CFG.gscSite && S.google && S.google.connected);
  const rows = Number(CFG.mozRows) || 1000, vol = g ? Number(CFG.volumeLimit) || 0 : 0;
  $("s-cost").innerHTML = `<b>Estimated cost of one build</b>
    <div class="small">Moz API: up to <b>${fmt(rows + vol * 5)} rows</b> (${fmt(rows)} ranking keywords${g ? ` + search volume for up to ${fmt(vol)} Search Console keywords at up to 5 rows each` : ""}). Your plan's quota is shown in the Moz API dashboard.</div>
    <div class="small">Google: free (Search Console and GA4 have no per-call cost). Claude: none to build. Asking Claude to review costs one request per 5 keywords or 8 topic groups on your Anthropic account, usually a few cents each.</div>`;
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
async function refreshGoogle() {
  try { S.google = await api("google/status"); } catch (e) { S.google = { error: e.message }; }
  const g = S.google;
  if (g && g.connected) {
    const d = siteDomain();
    if (!CFG.gscSite && d && g.sites) { const m = g.sites.find(s => s.siteUrl === "sc-domain:" + d) || g.sites.find(s => s.siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") === d); if (m) { CFG.gscSite = m.siteUrl; saveSettings(); } }
    if (CFG.gscSite && g.sites && !g.sites.some(s => s.siteUrl === CFG.gscSite)) { CFG.gscSite = ""; saveSettings(); }
  }
  renderGoogle(); renderCost();
}
function renderGoogle() {
  const el = $("g-box"), g = S.google;
  if (!g) { el.innerHTML = '<span class="muted small">Checking…</span>'; return; }
  if (g.error) { el.innerHTML = `<span class="src-bad small">${esc(g.error)}</span> <button class="btn small" type="button" id="g-retry">Try again</button>`; $("g-retry").onclick = () => { S.google = null; renderGoogle(); refreshGoogle(); }; return; }
  if (!g.configured) { el.innerHTML = `<p class="small" style="margin:0"><span class="pill neutral">Not available on this deployment</span> The library uses Moz ranking data. Whoever runs this app can turn on Google sign-in by adding a Google OAuth client (see the README).</p>`; return; }
  if (!g.connected) {
    el.innerHTML = `<p class="small" style="margin:0">Read-only access to Search Console and Google Analytics. Your Google sign-in is kept in an encrypted cookie in this browser; your Search Console and GA4 data are never stored on the server.</p><div class="filter-row"><a class="btn primary" href="/api/google/login">Connect Google</a></div>`;
    return;
  }
  const sites = g.sites || [], props = g.properties || [];
  el.innerHTML = `<div class="small">Connected as <b>${esc(g.email || "your Google account")}</b> <button class="btn small" type="button" id="g-logout">Disconnect</button></div>
    <div class="field"><label for="s-gsc">Search Console property</label><select id="s-gsc"><option value="">Don't use Search Console (Moz only)</option>${sites.map(s => `<option value="${esc(s.siteUrl)}">${esc(s.siteUrl)}</option>`).join("")}</select>
      <span class="hint">${g.sitesError ? `<span class="src-bad">${esc(g.sitesError)}</span>` : sites.length ? "Query → page data for the last 3 months: shows every page that appears for a keyword, with clicks and impressions." : "No verified Search Console properties on this account."}</span></div>
    <div class="field"><label for="s-ga4">GA4 property (optional)</label><select id="s-ga4"><option value="">Don't add GA4 sessions</option>${props.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.account)} (${esc(p.id)})</option>`).join("")}</select>
      <span class="hint">${g.propertiesError ? `<span class="src-bad">${esc(g.propertiesError)}</span>` : "Adds sessions per page for the last 12 months to the library."}</span></div>`;
  $("s-gsc").value = CFG.gscSite || ""; $("s-ga4").value = CFG.ga4Property || "";
  $("s-gsc").onchange = () => { CFG.gscSite = $("s-gsc").value; saveSettings(); renderCost(); };
  $("s-ga4").onchange = () => { CFG.ga4Property = $("s-ga4").value; saveSettings(); };
  $("g-logout").onclick = async () => { try { await fetch("/api/google/logout", { method: "POST" }); } catch (e) {} CFG.gscSite = ""; CFG.ga4Property = ""; saveSettings(); S.google = null; renderGoogle(); refreshGoogle(); toast("Google disconnected."); };
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
  $("s-clear").onclick = async () => { await Promise.all([IDB.del(K.lib()), IDB.del(K.reviews()), IDB.del(K.checks()), IDB.del(K.topics())]); S.data = null; S.meta = null; S.reviews = new Map(); S.checks = []; S.topicReviews = {}; renderDataBox(); updateStatus(); toast("Library, reviews and checks deleted from this browser."); };
}
function bindSettings() {
  const upd = () => {
    const before = siteDomain();
    CFG.moz = $("s-moz").value.trim(); CFG.claude = $("s-claude").value.trim(); CFG.domain = $("s-domain").value.trim(); CFG.brand = $("s-brand").value.trim();
    CFG.exclude = $("s-exclude").value.trim(); CFG.sections = $("s-sections").value.trim(); CFG.model = $("s-model").value; CFG.remember = $("s-remember").checked;
    CFG.volumeLimit = Number($("s-vol").value) || 0;
    saveSettings();
    if (siteDomain() !== before) { S.site = null; CFG.gscSite = ""; CFG.ga4Property = ""; saveSettings(); refreshSite(); refreshGoogle(); openLibrary(); }
    updateStatus(); renderCost();
  };
  ["s-moz", "s-claude", "s-domain", "s-brand", "s-exclude", "s-sections", "s-model", "s-remember", "s-vol"].forEach(id => $(id).addEventListener("change", upd));
  $("s-models").onclick = () => { upd(); loadModels(); };
  $("s-index").onclick = async () => {
    upd(); const s = S.site || {};
    const restart = !(s.crawling && !S.indexing) && (!!s.ready || !!s.crawling);
    try { await indexSite(null, { restart }); toast("Site indexed."); } catch (e) { $("s-msg2").textContent = e.message; }
  };
  $("s-build").onclick = () => { upd(); buildLib(); };
  $("s-forget").onclick = () => { CFG.moz = ""; CFG.claude = ""; CFG.remember = false; try { sessionStorage.removeItem(SKEY); } catch (e) {} saveSettings(); renderSettings(); toast("Keys removed from this browser."); };
}

// ---------- build the library ----------
async function buildLib() {
  if (S.building) return;
  const d = siteDomain();
  if (!d || (!CFG.moz && !S.mock)) { toast("Add your Moz API token and domain first."); location.hash = "#settings"; return; }
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
    const useG = !!(S.google && S.google.connected);
    const steps = [useG && CFG.gscSite ? "Search Console" : null, useG && CFG.ga4Property ? "GA4" : null, "Moz ranking keywords"].filter(Boolean).join(", ");
    tick = setInterval(() => say(`Reading ${steps} and finding pages that compete… ${Math.round((Date.now() - t0) / 1000)}s (usually 1–3 minutes)`), 1000);
    const { library } = await api("library", {
      domain: d, brandTerms: listOf(CFG.brand).length ? listOf(CFG.brand) : [d.split(".")[0]], exclude: listOf(CFG.exclude),
      mozRows: Number(CFG.mozRows) || 1000, volumeLimit: Number(CFG.volumeLimit) || 0,
      gscSite: useG ? CFG.gscSite || "" : "", ga4Property: useG ? CFG.ga4Property || "" : "",
    });
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
