import { askJSON } from "@/lib/claude";
import { json, fail, body, isMock } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

// Asks Claude for JSON with the caller's own Anthropic key (prompts are built in the page).
export async function POST(req: Request) {
  try {
    const { prompt, model } = await body<{ prompt: string; model: string }>(req);
    if (isMock()) {
      if (/Reply with only JSON: \{"verdict"/.test(prompt)) return json({ json: { verdict: "Refresh existing", reason: "An existing page covers this closely (mock answer).", primary_url: "", suggested_angle: "A practical checklist", suggested_target_keyword: "example keyword", link_to: [] } });
      const kws = [...prompt.matchAll(/"keyword":"([^"]+)"/g)].map(m => m[1]);
      if (kws.length) return json({ json: [...new Set(kws)].map(k => ({ keyword: k, summary: `Keep one primary page for "${k}" (mock answer).`, urls: [] })) });
      const topics = [...prompt.matchAll(/"topic":"([^"]+)"/g)].map(m => m[1]);
      return json({ json: topics.map(t => ({ topic: t, review: `Merge the weaker pages on "${t}" into the strongest one (mock answer).` })) });
    }
    const key = req.headers.get("x-claude-key") || "";
    if (!key) return json({ error: { message: "Add your Claude API key in Settings.", code: "no_key" } }, 401);
    if (!model) return json({ error: { message: "Choose a Claude model in Settings.", code: "no_model" } }, 400);
    if (!prompt || prompt.length > 400_000) return json({ error: { message: "Bad prompt", code: "bad_prompt" } }, 400);
    const out = await askJSON(key, model, prompt, { maxTokens: 16000 });
    return json(out);
  } catch (e) { return fail(e); }
}
