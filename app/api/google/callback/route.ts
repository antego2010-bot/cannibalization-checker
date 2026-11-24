import { COOKIE, googleConfigured, readCookie, redirectUri, seal } from "@/lib/google";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const back = (msg: string) => new Response(null, { status: 302, headers: { location: "/#settings" + (msg ? "-" + msg : ""), "set-cookie": "g_state=; Path=/; Max-Age=0" } });
  if (!googleConfigured()) return back("google-not-configured");
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("google-cancelled");
  if (!url.searchParams.get("state") || url.searchParams.get("state") !== readCookie(req, "g_state")) return back("google-state");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.refresh_token) return back("google-failed");
  let email = "";
  try { email = JSON.parse(Buffer.from(String(j.id_token).split(".")[1], "base64url").toString("utf8")).email || ""; } catch { /* */ }
  const cookie = `${COOKIE}=${seal({ rt: j.refresh_token, email })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${180 * 86400}`;
  const h = new Headers({ location: "/#settings" });
  h.append("set-cookie", cookie); h.append("set-cookie", "g_state=; Path=/; Max-Age=0");
  return new Response(null, { status: 302, headers: h });
}
