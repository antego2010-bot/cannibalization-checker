import zlib from "zlib";
import { getIndex } from "@/lib/crawl";
import { normDomain } from "@/lib/http";
import { buildLibrary } from "@/lib/library";
import { accessToken, ga4Sessions, gscQueryPages, sessionOf } from "@/lib/google";
import { json, fail, body, isMock } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

// Builds the library for one site. Google data (if connected) is read with the user's own sign-in and never stored on the server.
export async function POST(req: Request) {
  try {
    type Up = { gscUpload?: { rows: [string, string, number, number, number][]; start?: string; end?: string; name?: string }; ga4Upload?: { rows: [string, number][]; name?: string } };
    let b: { domain: string; brandTerms?: string[]; exclude?: string[]; include?: string[]; mozRows?: number; volumeLimit?: number; gscSite?: string; ga4Property?: string } & Up;
    if (req.headers.get("x-body-encoding") === "gzip") {
      // Uploaded Search Console / GA4 exports arrive gzipped (they can be large). Processed in memory only, never stored.
      const raw = zlib.gunzipSync(Buffer.from(await req.arrayBuffer()), { maxOutputLength: 80_000_000 });
      b = JSON.parse(raw.toString("utf8"));
    } else b = await body(req);
    const domain = normDomain(b.domain);
    if (!domain) return json({ error: { message: "Enter your site's domain in Settings.", code: "no_domain" } }, 400);
    const mozToken = req.headers.get("x-moz-token") || "";
    if (!mozToken && !isMock()) return json({ error: { message: "Add your Moz API token in Settings.", code: "no_token" } }, 401);
    const index = await getIndex(domain);
    if (!index || index.status !== "ready") return json({ error: { message: "Index your site first (Settings → Index my site).", code: "not_indexed" } }, 409);
    let gsc: { rows: { query: string; page: string; clicks: number; impressions: number; position: number }[]; start: string; end: string; siteUrl: string } | null = null, ga4: Map<string, number> | null = null;
    let ga4Label = b.ga4Property;
    if (b.gscUpload && Array.isArray(b.gscUpload.rows)) {
      gsc = { rows: b.gscUpload.rows.map(r => ({ query: String(r[0]), page: String(r[1]), clicks: Number(r[2]) || 0, impressions: Number(r[3]) || 0, position: Number(r[4]) || 99 })), start: b.gscUpload.start || "", end: b.gscUpload.end || "", siteUrl: "uploaded file" + (b.gscUpload.name ? " " + b.gscUpload.name : "") };
    }
    if (b.ga4Upload && Array.isArray(b.ga4Upload.rows)) {
      ga4 = new Map(); for (const [p, n] of b.ga4Upload.rows) { const k = String(p).split(/[?#]/)[0].replace(/\/+$/, "") || "/"; ga4.set(k, (ga4.get(k) || 0) + (Number(n) || 0)); }
      ga4Label = "uploaded file" + (b.ga4Upload.name ? " " + b.ga4Upload.name : "");
    }
    if (gsc || ga4) { /* uploaded data wins over Google sign-in */ }
    else if (isMock() && (b.gscSite || b.ga4Property)) {
      const m = mockGoogle(domain);
      if (b.gscSite) gsc = { ...m.gsc, siteUrl: b.gscSite };
      if (b.ga4Property) ga4 = m.ga4;
    } else if (b.gscSite || b.ga4Property) {
      const s = sessionOf(req);
      if (!s) return json({ error: { message: "Connect Google in Settings, or switch the source to Moz only.", code: "google_not_connected" } }, 401);
      const token = await accessToken(s);
      if (b.gscSite) gsc = { ...(await gscQueryPages(token, b.gscSite)), siteUrl: b.gscSite };
      if (b.ga4Property) ga4 = await ga4Sessions(token, b.ga4Property);
    }
    const mozRows = [500, 1000, 2500, 5000].includes(Number(b.mozRows)) ? Number(b.mozRows) : 1000;
    const volumeLimit = Math.max(0, Math.min(1000, Number(b.volumeLimit ?? 200)));
    const brand = (b.brandTerms && b.brandTerms.length ? b.brandTerms : [domain.split(".")[0]]).map(s => String(s).trim()).filter(Boolean);
    const lib = await buildLibrary({ domain, brandTerms: brand, pages: index.pages, excludePrefixes: (b.exclude || []).map(String), includePrefixes: (b.include || []).map(String), mozToken, mozRows, volumeLimit, gsc, ga4, ga4Property: ga4Label, mock: isMock() });
    // Gzipped so big sites stay under the 4.5 MB response limit; the page unzips it.
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ library: lib })));
    return new Response(new Uint8Array(gz), { headers: { "content-type": "application/octet-stream", "x-library-encoding": "gzip", "cache-control": "no-store" } });
  } catch (e) { return fail(e); }
}

function mockGoogle(domain: string) {
  const u = (p: string) => `https://${domain}${p}`;
  const rows = [
    { query: "generative engine optimization", page: u("/blog/generative-engine-optimization"), clicks: 420, impressions: 18000, position: 6.2 },
    { query: "generative engine optimization", page: u("/blog/ai-search-tips"), clicks: 95, impressions: 7400, position: 9.8 },
    { query: "ai search tips", page: u("/blog/ai-search-tips"), clicks: 60, impressions: 2100, position: 4.1 },
    { query: "ai search tips", page: u("/blog/generative-engine-optimization"), clicks: 12, impressions: 900, position: 14.5 },
    { query: "keyword research tool", page: u("/explorer"), clicks: 900, impressions: 30000, position: 3.2 },
    { query: "keyword research tool", page: u("/blog/ai-search-tips"), clicks: 4, impressions: 3200, position: 18.4 },
  ];
  return { gsc: { rows, start: "2026-08-23", end: "2026-11-21" }, ga4: new Map([["/blog/generative-engine-optimization", 15400], ["/blog/ai-search-tips", 3900], ["/explorer", 52000]]) };
}
