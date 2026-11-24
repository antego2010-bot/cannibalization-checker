#!/usr/bin/env python3
"""Builds public/index.html + public/app.js from the cannibalization checker artifact (src/cannib.html) plus the Vercel parts."""
import pathlib, re, sys

HERE = pathlib.Path(__file__).parent
SRC = (HERE / "source.html").read_text()
OUT = HERE.parent / "public"


def rep(s, old, new, count=1):
    n = s.count(old)
    if n < 1 or (count and n != count):
        sys.exit(f"patch failed ({n} matches): {old[:90]!r}")
    return s.replace(old, new)


# ---------------- HTML ----------------
head, rest = SRC.split("<body>", 1)
body = rest.split('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx', 1)[0]
script = SRC.split("<script>\n(() => {\n", 1)[1].rsplit("})();\n</script>", 1)[0]

head = rep(head, "<title>Cannibalization checker tool</title>", '<title>Keyword cannibalization checker</title>\n<meta name="description" content="Find pages on your site that compete for the same keywords, with Moz and Google Search Console data, and get Claude\'s fix for each one.">')
head = rep(head, "</style>", (HERE / "extra.css").read_text() + "</style>")

body = rep(body, '<div class="mark" aria-hidden="true">M</div>', '<div class="mark" aria-hidden="true" id="brand-mark">C</div>')
body = rep(body, "<h1>Cannibalization checker tool</h1>", "<h1>Keyword cannibalization checker</h1>")
body = rep(body, '<div class="sub">moz.com URL Library · Search Console (last 3 months) + Moz API</div>', '<div class="sub" id="brand-sub"></div>')
body = rep(body, '<span id="status-text"><span class="dot busy"></span>Loading the library…</span>', '<span id="status-text"><span class="dot busy"></span>Loading…</span>')
body = rep(body, '<button class="btn-ghost" id="refresh-btn" type="button">Refresh from Google Sheet</button>',
           '<a class="btn-ghost" id="g-head" href="/api/google/login" hidden>Sign in with Google</a>\n      <button class="btn-ghost" id="xlsx-btn" type="button" hidden>Download .xlsx</button>\n      <button class="btn-ghost" id="rebuild-btn" type="button" hidden>Rebuild library</button>')
body = rep(body, '<a href="#topic-check" data-tab="topic-check">Topic check</a>', '<a href="#topic-check" data-tab="topic-check">Topic check</a>\n    <a href="#settings" data-tab="settings">Settings</a>')
body = re.sub(r'<div id="loading" class="panel skeleton">.*?</span>\n  </div>\n', '<div id="loading" class="panel skeleton">\n    <div class="spinner" aria-hidden="true"></div>\n    <strong>Opening…</strong>\n  </div>\n', body, count=1, flags=re.S)
body = rep(body, 'Keywords where more than one moz.com URL ranks (Search Console query → page data, Moz fallback).', 'Keywords where more than one of your URLs ranks.')
body = rep(body, '<h2 style="font-size:17px">Does moz.com already cover this?</h2>', '<h2 style="font-size:17px">Does <span data-site>your site</span> already cover this?</h2>')
body = rep(body, '<span class="small muted">Shared with everyone who opens this tool</span>', '<span class="small muted">Saved in this browser</span>')
body = rep(body, "</main>", (HERE / "settings.html").read_text() + "</main>")
body = body.rstrip() + '\n<footer class="foot small muted">Keys and libraries stay in your browser. <a href="/privacy.html">Privacy</a> · Built with the Moz API and Claude.</footer>\n'

# ---------------- JS ----------------
top = (HERE / "top.js").read_text()
bottom = (HERE / "bottom.js").read_text()
mid = script.split("// ---------- model ----------", 1)[1].split("// ---------- boot ----------", 1)[0]
mid = "// ---------- model ----------" + mid

# applyData: status + per-dataset defaults
mid = rep(mid, '''  const age = (Date.now() - new Date(loadedAt)) / 864e5;
  setStatus("ok", statusLine() + (age > 35 ? " · over a month old, press Refresh" : ""));
  $("loading").hidden = true;''', '''  updateStatus();
  $("loading").hidden = true;''')
mid = rep(mid, '''(/(https:\\/\\/moz\\.com\\S*) \\(#(\\d+)\\)/g)''', '''(/(https?:\\/\\/\\S+) \\(#(\\d+)\\)/g)''')

# rule-based recs: generic hubs + Moz-only wording
mid = rep(mid, '''  const secM = im["Section"] || "", secC = ic["Section"] || "";''', '''  const secM = im["Section"] || "", secC = ic["Section"] || "";
  if (u.pos == null && u.clicks == null) return { action: "Retarget or merge", cls: "warn", text: `Its title and URL target ${kw}, but ${short(main.url)} is the page that ranks${main.pos != null ? ` (#${fmt(main.pos)})` : ""}. Give this page its own angle in the title and H1 and link to ${short(main.url)} with ${kw} as the anchor, or merge it in if it adds little.` };''')
mid = rep(mid, 'const hubs = ["Learn", "BGuide", "Product"];', 'const hubs = ["Learn", "Guide", "Product", "Resources", "Docs", "Academy"];')
mid = rep(mid, 'return { action: "Keep as primary", cls: "good", text: "Most clicks for this keyword. Keep it as', 'return { action: "Keep as primary", cls: "good", text: (u.clicks != null ? "Most clicks" : "Best position") + " for this keyword. Keep it as')
mid = rep(mid, 'text: `Weaker match (#${fmt(u.pos)}, ${fmt(u.clicks)} clicks).', 'text: `Weaker match (#${fmt(u.pos)}${u.clicks != null ? `, ${fmt(u.clicks)} clicks` : ""}).')
mid = rep(mid, 'text: `Traffic is split (${Math.round(share * 100)}% of clicks here, #${fmt(u.pos)} vs #${fmt(main.pos)}).', 'text: `${u.clicks != null ? `Traffic is split (${Math.round(share * 100)}% of clicks here, ` : "Both rank close together ("}#${fmt(u.pos)} vs #${fmt(main.pos)}).')
mid = rep(mid, '''  if (u.impr != null && u.impr < 20 && (u.pos == null || u.pos > 20))''', '''  if (u.impr != null && u.impr < 20 && (u.pos == null || u.pos > 20))''')

# routing is defined in bottom.js
mid = re.sub(r"// ---------- routing ----------\nconst ROUTES.*?window\.addEventListener\(\"hashchange\", route\);\n", "", mid, count=1, flags=re.S)

# library columns
mid = rep(mid, 'const NUMERIC = new Set(["Target keyword volume", "Clicks (3 mo)", "Impressions (3 mo)", "Avg position"]);', 'const NUMERIC = new Set(["Target keyword volume", "Clicks (3 mo)", "Impressions (3 mo)", "Avg position", "Sessions (12 mo)"]);')
mid = rep(mid, '"Clicks (3 mo)", "Impressions (3 mo)", "Avg position", "Overlap type"];', '"Clicks (3 mo)", "Impressions (3 mo)", "Avg position", "Sessions (12 mo)", "Overlap type"];')
mid = rep(mid, '''  if (!libInit) {
    S.lib.hidden = new Set(cols.filter(c => !DEFAULT_COLS.includes(c)));''', '''  if (S.libColsFor !== S.loadedAt) {
    const hasVal = (c) => S.inv.some(r => r[c] !== "" && r[c] != null);
    S.lib.hidden = new Set(cols.filter(c => !DEFAULT_COLS.includes(c) || !hasVal(c)));
    S.lib.sort = hasVal("Clicks (3 mo)") ? { key: "Clicks (3 mo)", dir: -1 } : hasVal("Sessions (12 mo)") ? { key: "Sessions (12 mo)", dir: -1 } : { key: "Target keyword volume", dir: -1 };
    S.libColsFor = S.loadedAt;
  }
  if (!libInit) {''')
mid = rep(mid, '''    ["Clicks (3 mo)", DEMO ? MASK : sum("Clicks (3 mo)")],
    ["Impressions (3 mo)", DEMO ? MASK : sum("Impressions (3 mo)")],
    ["Ranking 1–20", cnt(r => String(r["Ranking status"]).includes("1–20"))],''', '''    ...(S.meta && S.meta.mode === "gsc" ? [["Clicks (3 mo)", DEMO ? MASK : sum("Clicks (3 mo)")], ["Impressions (3 mo)", DEMO ? MASK : sum("Impressions (3 mo)")]] : []),
    ...(S.inv.some(r => r["Sessions (12 mo)"] !== "" && r["Sessions (12 mo)"] != null) ? [["Sessions (12 mo)", DEMO ? MASK : sum("Sessions (12 mo)")]] : []),
    ["Ranking (top 20)", cnt(r => !String(r["Ranking status"]).startsWith("Not"))],''')
mid = rep(mid, '''<span class="pill ${String(v).includes("1–20") ? "good" : String(v).includes("21") ? "warn" : String(v).includes("Not") ? "bad" : "neutral"}">''', '''<span class="pill ${/^(Top 3|Page 1)/.test(String(v)) ? "good" : /^Page 2/.test(String(v)) ? "warn" : String(v).includes("Not") ? "bad" : "neutral"}">''')

# cannibalized view: Claude for both modes
mid = rep(mid, '''  $("cn-ask-page").onclick = () => reviewBatch(S.cn.visible || []);''', '''  $("cn-ask-page").onclick = () => S.cn.mode === "topic" ? reviewTopics(S.cn.tvisible || []) : reviewBatch(S.cn.visible || []);''')
mid = rep(mid, '''  $("cn-kw-filters").hidden = topic; $("cn-topic-filters").hidden = !topic; $("cn-actions").hidden = topic;
  $("cn-mode-help").textContent = topic ? "Groups of pages that cover the same topic, with Claude's review of each group." : "Keywords where more than one moz.com URL ranks (Search Console query → page data, Moz fallback).";''', '''  $("cn-kw-filters").hidden = topic; $("cn-topic-filters").hidden = !topic;
  $("cn-ask-page").textContent = topic ? "Ask Claude to review this page of topic groups" : "Ask Claude to review this page of keywords";
  $("cn-mode-help").textContent = topic ? "Groups of pages that cover the same topic, with Claude's review of each group." : (S.meta && S.meta.mode === "gsc" ? "Keywords where more than one of your URLs gets real impressions (Search Console query → page data, Moz for the rest)." : "Keywords where more than one of your URLs competes: close keyword variants ranking different pages (Moz), and pages whose title and URL target a keyword another page ranks for.");''')
mid = rep(mid, '''  $("cn-ask-page").title = SAMPLE ? "" : "Asking Claude isn't available in this view";''', '''  $("cn-ask-page").title = SAMPLE ? "" : "Add your Claude API key and model in Settings";''')
mid = rep(mid, '''  const slice = list.slice(S.cn.tpage * PAGE_LIB, (S.cn.tpage + 1) * PAGE_LIB);
  $("cn-meta").textContent = `${list.length.toLocaleString()} topic groups`;''', '''  const slice = list.slice(S.cn.tpage * PAGE_LIB, (S.cn.tpage + 1) * PAGE_LIB);
  S.cn.tvisible = slice.slice(0, 24);
  $("cn-meta").textContent = `${list.length.toLocaleString()} topic groups`;
  $("cn-ask-page").disabled = !SAMPLE || !slice.length || !!S.cn.ctl;
  $("cn-ask-page").title = SAMPLE ? "Reviews the first 24 groups on this page" : "Add your Claude API key and model in Settings";''')
mid = rep(mid, '''    ["With ranking evidence", list.filter(r => r["Ranking cannibalization evidence?"] === "Yes").length],
    ["Impressions", DEMO ? MASK : list.reduce((a, r) => a + (num(r["Total impressions (3 mo)"]) || 0), 0)],''', '''    ["With ranking evidence", list.filter(r => r["Ranking cannibalization evidence?"] === "Yes").length],
    ...(S.meta && S.meta.mode === "gsc" ? [["Impressions", DEMO ? MASK : list.reduce((a, r) => a + (num(r["Total impressions (3 mo)"]) || 0), 0)]] : []),
    ["Reviewed by Claude", list.filter(r => S.topicReviews[r["Topic"]]).length],''')
mid = rep(mid, '''<td class="rec" style="max-width:360px"><div>${linkify(r["Claude review"] || r["Suggested action"])}</div><div class="src">${r["Claude review"] ? "Claude review" : "Suggested action"}</div></td></tr>`''',
          '''<td class="rec ${S.topicReviews[r["Topic"]] ? "claude-rec" : ""}" style="max-width:360px"><div>${linkify(S.topicReviews[r["Topic"]] || r["Suggested action"])}</div><div class="src">${S.topicReviews[r["Topic"]] ? "Claude review" : "Rule-based suggestion"}</div></td></tr>`''')

# Claude review prompt: any site
mid = rep(mid, "const REVIEW_RULES = `You are a senior technical SEO reviewing keyword cannibalization on moz.com.", "const REVIEW_RULES = () => `You are a senior technical SEO reviewing keyword cannibalization on ${siteDomain()}.")
mid = rep(mid, 'The "Main" URL (most Search Console clicks) is usually primary, unless a Learn, Beginner\'s Guide or product/tool page clearly matches the intent better: then recommend swapping.',
          'The "Main" URL (most Search Console clicks, or best position when only Moz data is available) is usually primary, unless a hub, guide, learn or product/tool page clearly matches the intent better: then recommend swapping.')
mid = rep(mid, "Flag checking backlinks first (old Whiteboard Friday and blog posts often carry links).", "Flag checking backlinks first (older posts often carry links).")
mid = rep(mid, "const prompt = `${REVIEW_RULES}\n\nData (Search Console last 3 months; positions are average positions):", "const prompt = `${REVIEW_RULES()}\n\nData (${S.meta && S.meta.mode === \"gsc\" ? \"Search Console last 3 months; positions are average positions\" : \"Moz ranking data: positions are current Google positions; clicks and impressions are unknown (null)\"}):")
mid = rep(mid, '    default: return "Claude couldn\'t answer just now. Try again.";', '    default: if (e && e.name === "AbortError") return "Stopped."; return (e && e.message) || "Claude couldn\'t answer just now. Try again.";')
mid = rep(mid, ', reviewedAt: new Date().toISOString(), by: "artifact" };', ', reviewedAt: new Date().toISOString(), by: "app" };')
mid = rep(mid, '''        if (DB && !S.readOnly) { try { await DB.doc("reviews/" + g.id).set(doc); } catch (e) { if (e && e.code === "invalid_argument") S.readOnly = true; } }
      }''', '''      }
      await saveReviews();''')
mid = rep(mid, '''`Reviewed ${done} keyword${done === 1 ? "" : "s"}.` + (S.readOnly ? " (Saved for you only: you can't save to the shared store.)" : ""));''', '''`Reviewed ${done} keyword${done === 1 ? "" : "s"}. Saved in this browser.`);''')
mid = re.sub(r"function subscribeShared\(\) \{.*?\n\}\n", "", mid, count=1, flags=re.S)

# topic check: any site
mid = rep(mid, '.replace(/https?:\\/\\/moz\\.com/g, " ")', '.replace(/https?:\\/\\/[^\\/\\s]+/g, " ")')
mid = rep(mid, '(${fmt(num(exactKw["Search volume"]))} searches/mo)', '${num(exactKw["Search volume"]) != null ? `(${fmt(num(exactKw["Search volume"]))} searches/mo)` : ""}')
mid = rep(mid, 'title: `moz.com already ranks for "${exactKw["Keyword"]}"`', 'title: `${siteDomain()} already ranks for "${exactKw["Keyword"]}"`')
mid = rep(mid, '''(${top.r["Section"]}, ${top.r["Ranking status"]}, ${fmt(num(top.r["Clicks (3 mo)"]))} clicks)''', '''(${[top.r["Section"], top.r["Ranking status"], num(top.r["Clicks (3 mo)"]) != null ? fmt(num(top.r["Clicks (3 mo)"])) + " clicks" : ""].filter(Boolean).join(", ")})''')
mid = rep(mid, '''· ${fmtS(num(p.r["Clicks (3 mo)"]))} clicks</div>''', '''${num(p.r["Clicks (3 mo)"]) != null ? ` · ${fmtS(num(p.r["Clicks (3 mo)"]))} clicks` : ""}</div>''')
mid = rep(mid, '''let tcInit = false;
function ensureTopicCheck() {
  if (tcInit) return; tcInit = true;
  $("tc-form").addEventListener("submit", (e) => { e.preventDefault(); renderCheck(runCheck($("tc-topic").value, "")); });
  $("tc-ask").onclick = askClaudeTopic;
  $("tc-topic").value = "How to fix keyword cannibalization";''', '''let tcInit = false, tcBound = false;
function ensureTopicCheck() {
  if (!tcBound) { tcBound = true; $("tc-form").addEventListener("submit", (e) => { e.preventDefault(); renderCheck(runCheck($("tc-topic").value, "")); }); $("tc-ask").onclick = askClaudeTopic; }
  if (tcInit) { $("tc-ask").disabled = !tcLast || !SAMPLE; return; } tcInit = true;
  const ex = S.inv.find(r => r["Target keyword"]) || S.inv[0];
  $("tc-topic").value = ex ? String(ex["Primary topic"] || ex["Target keyword"] || "") : "";''')
mid = rep(mid, '''  const prompt = `You are Moz's SEO content strategist. A writer wants to publish on moz.com:''', '''  const site = siteDomain(), clicksKnown = S.meta && S.meta.mode === "gsc";
  const prompt = `You are ${brandName()}'s SEO content strategist. A writer wants to publish on ${site}:''')
mid = rep(mid, "Closest existing moz.com pages (Search Console last 3 months):", "Closest existing ${site} pages (${clicksKnown ? \"Search Console last 3 months\" : \"Moz ranking data; clicks unknown\"}):")
mid = rep(mid, "moz.com keywords already ranking that match:", "${site} keywords already ranking that match:")
mid = rep(mid, '''    const out = await SAMPLE.json(prompt, { modelTier: "default" });''', '''    const out = await SAMPLE.json(prompt);''')
mid = rep(mid, '''    if (DB && !S.readOnly) {
      try { await DB.collection("checks").add({ topic: String(res.topic).slice(0, 300), keyword: String(res.kw || "").slice(0, 120), verdict: String(out.verdict || "").slice(0, 40), reason: String(out.reason || "").slice(0, 600), primary_url: String(out.primary_url || "").slice(0, 300), angle: String(out.suggested_angle || "").slice(0, 300), at: new Date().toISOString() }); }
      catch (e) { if (e && e.code === "invalid_argument") S.readOnly = true; }
    }''', '''    S.checks.unshift({ topic: String(res.topic).slice(0, 300), keyword: String(res.kw || "").slice(0, 120), verdict: String(out.verdict || "").slice(0, 40), reason: String(out.reason || "").slice(0, 600), primary_url: String(out.primary_url || "").slice(0, 300), angle: String(out.suggested_angle || "").slice(0, 300), at: new Date().toISOString() });
    S.checks = S.checks.slice(0, 30); saveLocal(K.checks(), S.checks); renderHistory();''')
mid = rep(mid, "No saved checks yet. Claude verdicts are saved here for the team.", "No saved checks yet. Claude verdicts are saved here, in this browser.")

for bad in ["moz.com", "DB.", "MCP", "SHEET", "Whiteboard"]:
    if bad in mid:
        lines = [l[:120] for l in mid.splitlines() if bad in l]
        sys.exit(f"leftover {bad!r}: {lines}")

app = "(() => {\n" + top + "\n" + mid + "\n" + bottom + "})();\n"
html = head + "<body>" + body + '<script src="/app.js"></script>\n</body>\n</html>\n'
OUT.mkdir(exist_ok=True)
(OUT / "app.js").write_text(app)
(OUT / "index.html").write_text(html)
print("ok", len(html), len(app))
