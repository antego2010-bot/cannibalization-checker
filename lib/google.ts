// Google sign-in (OAuth) for Search Console + GA4. The user's refresh token lives only in an encrypted,
// httpOnly cookie on their own browser; nothing is stored on the server.
import crypto from "crypto";

export const SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];
export const COOKIE = "g_sess";

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const key = () => crypto.createHash("sha256").update(String(process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET) + "|cannib-cookie").digest();

export function seal(obj: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}
export function unseal<T>(s: string | undefined | null): T | null {
  if (!s) return null;
  try {
    const b = Buffer.from(s, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) as T;
  } catch { return null; }
}
export function readCookie(req: Request, name: string): string | null {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
export type Session = { rt: string; email: string };
export const sessionOf = (req: Request) => unseal<Session>(readCookie(req, COOKIE));

export const redirectUri = (req: Request) => {
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || u.host;
  return `${proto}://${host}/api/google/callback`;
};

export class GoogleError extends Error {
  code: string; status: number;
  constructor(message: string, code = "google_error", status = 502) { super(message); this.code = code; this.status = status; }
}

export async function accessToken(s: Session): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: s.rt, grant_type: "refresh_token" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new GoogleError("Your Google connection has expired. Connect Google again in Settings.", "google_reauth", 401);
  return j.access_token;
}

async function gfetch(token: string, url: string, body?: unknown) {
  const res = await fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (j && j.error && j.error.message) || `Google answered ${res.status}`;
    if (res.status === 403 && /has not been used|is disabled/i.test(msg)) throw new GoogleError("This Google API isn't enabled for the app's Google Cloud project: " + msg, "api_disabled", 502);
    if (res.status === 403) throw new GoogleError("Your Google account doesn't have access: " + msg, "forbidden", 403);
    throw new GoogleError(msg, "google_" + res.status, 502);
  }
  return j;
}

export async function listSites(token: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const j = await gfetch(token, "https://www.googleapis.com/webmasters/v3/sites");
  return (j.siteEntry || []).filter((s: { permissionLevel: string }) => s.permissionLevel !== "siteUnverifiedUser");
}
export async function listProperties(token: string): Promise<{ id: string; name: string; account: string }[]> {
  const out: { id: string; name: string; account: string }[] = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const j = await gfetch(token, "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200" + (pageToken ? "&pageToken=" + pageToken : ""));
    (j.accountSummaries || []).forEach((a: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }) => (a.propertySummaries || []).forEach(p => out.push({ id: p.property.replace("properties/", ""), name: p.displayName, account: a.displayName })));
    if (!j.nextPageToken) break; pageToken = j.nextPageToken;
  }
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
export type GscRow = { query: string; page: string; clicks: number; impressions: number; position: number };
/** Query × page rows for the last ~3 months (positions ≤ maxPos), paged up to maxRows. */
export async function gscQueryPages(token: string, siteUrl: string, maxRows = 100000, maxPos = 20): Promise<{ rows: GscRow[]; start: string; end: string }> {
  const end = new Date(Date.now() - 3 * 864e5), start = new Date(end.getTime() - 90 * 864e5);
  const rows: GscRow[] = [];
  for (let startRow = 0; startRow < maxRows; startRow += 25000) {
    const j = await gfetch(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { startDate: ymd(start), endDate: ymd(end), dimensions: ["query", "page"], rowLimit: 25000, startRow, type: "web" });
    const got = (j.rows || []) as { keys: string[]; clicks: number; impressions: number; position: number }[];
    got.forEach(r => { if (r.position <= maxPos) rows.push({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position }); });
    if (got.length < 25000) break;
  }
  return { rows, start: ymd(start), end: ymd(end) };
}
/** Sessions per page path, last 12 months. */
export async function ga4Sessions(token: string, propertyId: string): Promise<Map<string, number>> {
  const j = await gfetch(token, `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
    dateRanges: [{ startDate: "365daysAgo", endDate: "yesterday" }], dimensions: [{ name: "pagePath" }], metrics: [{ name: "sessions" }], limit: 100000,
  });
  const m = new Map<string, number>();
  (j.rows || []).forEach((r: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }) => {
    const p = (r.dimensionValues[0].value || "/").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
    m.set(p, (m.get(p) || 0) + Number(r.metricValues[0].value || 0));
  });
  return m;
}
