import { accessToken, googleConfigured, listProperties, listSites, sessionOf } from "@/lib/google";
import { json, fail, isMock } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    if (isMock() && new URL(req.url).searchParams.get("mock") !== "off") return json({ configured: true, connected: true, email: "you@example.com", sites: [{ siteUrl: "sc-domain:moz.com", permissionLevel: "siteOwner" }], properties: [{ id: "123456", name: "moz.com - GA4", account: "Moz" }] });
    if (!googleConfigured()) return json({ configured: false, connected: false });
    const s = sessionOf(req);
    if (!s) return json({ configured: true, connected: false });
    const token = await accessToken(s);
    const [sites, props] = await Promise.allSettled([listSites(token), listProperties(token)]);
    return json({
      configured: true, connected: true, email: s.email,
      sites: sites.status === "fulfilled" ? sites.value : [], sitesError: sites.status === "rejected" ? String((sites.reason as Error).message) : null,
      properties: props.status === "fulfilled" ? props.value : [], propertiesError: props.status === "rejected" ? String((props.reason as Error).message) : null,
    });
  } catch (e) { return fail(e); }
}
