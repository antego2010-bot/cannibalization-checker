import crypto from "crypto";
import { googleConfigured, redirectUri, SCOPES } from "@/lib/google";

export const runtime = "nodejs";

// Starts Google sign-in (Search Console + GA4, read-only).
export async function GET(req: Request) {
  if (!googleConfigured()) return new Response("Google sign-in isn't set up on this deployment yet.", { status: 501 });
  const state = crypto.randomBytes(16).toString("hex");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(req), response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return new Response(null, { status: 302, headers: { location: u.toString(), "set-cookie": `g_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}
