import { defineSecret } from "firebase-functions/params";

// 👉 Secreto exportado desde aquí para reutilizar en otras funciones
export const OPENAI_SECRET = defineSecret("OPENAI_API_KEY");

export type IdeaParams = {
  seedInstruction?: string | null;
  topTags?: string[];
  topStyles?: string[];
  wantCategories: string[];
  preferCategory?: string;
};

export type IdeaMap = Record<string, string>;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_KEY = process.env.OPENAI_API_KEY as string;

// ---------- utils ----------
function uniqLower(a: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of a) {
    const k = (s || "").toString().trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function sanitizeLine(s: string): string {
  if (!s) return s;
  let out = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  out = out.replace(/[#🎉✨🔥💥😁😂😍👍🏆🎵🎬🎧🎤🎮🎯💡🧠]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 220) out = out.slice(0, 220);
  return out;
}

function fallbackLine(category: string, prefer?: string, tags: string[] = []) {
  const tag = tags[0] ? ` usando el tag ${tags[0]}` : "";
  const tono = prefer && prefer !== "global" ? ` con vibra ${prefer}` : "";
  return `Crea un clip <30s${tono}${tag} que enganche en los primeros 3s.`;
}

function extractJson(s: string): any | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const i = s.indexOf("{"); const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); } catch {}
  }
  return null;
}

function ensureAll(raw: any, want: string[], prefer?: string, tags: string[] = []): IdeaMap {
  const out: IdeaMap = {};
  for (const k of want) {
    const v = typeof raw?.[k] === "string" ? raw[k] : "";
    out[k] = sanitizeLine(v) || fallbackLine(k, prefer, tags);
  }
  return out;
}

function systemPrompt() {
  return [
    "Eres planner creativo de retos diarios de video.",
    "Entrega SOLO un objeto JSON con las claves pedidas.",
    "Cada valor: UNA línea, grabable en <30s, sin emojis, sin hashtags, sin comillas."
  ].join(" ");
}

function userPrompt(p: Required<Omit<IdeaParams,"seedInstruction">> & { seedInstruction: string | null }) {
  const styles = p.topStyles.length ? p.topStyles.join(", ") : "ninguno";
  const tags = p.topTags.length ? p.topTags.join(", ") : "ninguno";
  const seed = p.seedInstruction ?? "null";
  return `
Semilla (mejor reto de ayer, puede ser null):
${seed}

Estilos más usados: [${styles}]
Tags más usados: [${tags}]
Categoría con mejor desempeño: ${p.preferCategory}

Devuelve SOLO JSON válido con claves EXACTAS: ${JSON.stringify(p.wantCategories)}
Cada valor: UNA línea, clara, accionable, <30s, sin emojis/hashtags/comillas. Español neutro.
`.trim();
}

async function callOpenAI(sys: string, usr: string) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY no está definido");
  const rsp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ]
    }),
  });
  if (!rsp.ok) {
    const text = await rsp.text().catch(()=> "");
    throw new Error(`OpenAI ${rsp.status}: ${text}`);
  }
  const data = await rsp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return extractJson(content);
}

export async function generateChallengeIdeas(input: IdeaParams): Promise<IdeaMap> {
  const want = (input.wantCategories || []).map(s => (s || "").trim()).filter(Boolean);
  if (!want.length) throw new Error("wantCategories no puede estar vacío.");

  const topTags = uniqLower(input.topTags);
  const topStyles = uniqLower(input.topStyles);
  const prefer = (input.preferCategory || "global").toString();

  const sys = systemPrompt();
  const usr = userPrompt({
    seedInstruction: input.seedInstruction ?? null,
    topTags, topStyles, wantCategories: want, preferCategory: prefer
  });

  let raw: any = null;
  try { raw = await callOpenAI(sys, usr); }
  catch (e) { console.error("generateChallengeIdeas error:", (e as Error).message); }

  const ideas = ensureAll(raw, want, prefer, topTags);
  for (const k of Object.keys(ideas)) {
    let line = sanitizeLine(ideas[k]);
    if (/^graba un clip corto/i.test(line) && input.seedInstruction) {
      line = line.replace(/^graba un clip corto/i, "Crea un clip corto");
    }
    ideas[k] = line;
  }
  return ideas;
}
