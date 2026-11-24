import { COOKIE, sessionOf } from "@/lib/google";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const s = sessionOf(req);
  if (s) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(s.rt), { method: "POST" }).catch(() => {});
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}
