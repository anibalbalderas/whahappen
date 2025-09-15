// functions/src/ai.ts
//
// Generador de retos diarios guiado por señales reales (semilla + topTags + topStyles).
// - NO inicializa firebase-admin (no usar initializeApp aquí).
// - Usa OPENAI_API_KEY desde process.env (asegúrate de declarar el secreto en el cron con setGlobalOptions).
//
// Params:
//   - seedInstruction: instrucción del reto mejor rankeado de AYER (puede ser null)
//   - topTags: tags más usados ayer (["duet","remix",...])
//   - topStyles: estilos más usados ayer (["humor","cinemático",...])
//   - wantCategories: claves EXACTAS a devolver (["global","caritativo",...])
//   - preferCategory: modo que mejor rindió ayer (para orientar el tono)
// Return: Record<string,string> con una línea por categoría (sin emojis, sin hashtags, grabable <30s).

import OpenAI from "openai";

export type IdeaParams = {
  seedInstruction?: string | null;
  topTags?: string[];
  topStyles?: string[];
  wantCategories: string[];
  preferCategory?: string;
};

export type IdeaMap = Record<string, string>;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- Utilidades de texto ----------
function uniqLower(a: string[] = []): string[] {
  const seen = new Set<string>();
  for (const s of a) {
    const k = (s || "").toString().trim().toLowerCase();
    if (!k) continue;
    if (!seen.has(k)) seen.add(k);
  }
  return [...seen];
}

function sanitizeLine(s: string): string {
  if (!s) return s;
  // sin comillas envolventes, sin emojis comunes, sin hashtags
  let out = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  out = out.replace(/[#🎉✨🔥💥😁😂😍👍🏆🎵🎬🎧🎤🎮🎯💡🧠]/g, "");
  // colapsa espacios
  out = out.replace(/\s+/g, " ").trim();
  // evita instrucciones demasiado largas
  if (out.length > 220) out = out.slice(0, 220);
  return out;
}

function fallbackLine(category: string, preferCategory?: string, topTags: string[] = []): string {
  const tag = topTags[0] ? ` usando el tag ${topTags[0]}` : "";
  const tono = preferCategory && preferCategory !== "global" ? ` con vibra ${preferCategory}` : "";
  return `Graba un clip corto (<20s) que cuente algo auténtico${tono}${tag}; que sea claro desde los 3 primeros segundos.`;
}

// Intenta extraer el primer bloque JSON válido del texto
function extractJsonBlock(s: string): any | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    // Busca el primer {...} grande
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const chunk = s.slice(first, last + 1);
      try {
        return JSON.parse(chunk);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function ensureAllCategories(
  raw: any,
  want: string[],
  preferCategory?: string,
  topTags: string[] = []
): IdeaMap {
  const out: IdeaMap = {};
  for (const k of want) {
    const v = typeof raw?.[k] === "string" ? raw[k] : "";
    out[k] = sanitizeLine(v) || fallbackLine(k, preferCategory, topTags);
  }
  return out;
}

// ---------- Prompting ----------
function buildSystemPrompt() {
  return [
    "Eres planner creativo para retos diarios virales de video (tipo Reels/TikTok).",
    "Objetivo: generar instrucciones grabables en <20s, acción directa, claridad en 3s.",
    "Entregas SOLO un objeto JSON con claves EXACTAS de las categorías solicitadas.",
    "Cada valor es UNA línea de instrucción, sin emojis, sin hashtags, sin comillas.",
    "Evita referencias a marcas, política, violencia o temas sensibles.",
  ].join(" ");
}

function buildUserPrompt(params: Required<Omit<IdeaParams, "seedInstruction">> & { seedInstruction: string | null }) {
  const { seedInstruction, topTags, topStyles, wantCategories, preferCategory } = params;

  const stylesTxt = topStyles.length ? topStyles.join(", ") : "ninguno";
  const tagsTxt = topTags.length ? topTags.join(", ") : "ninguno";
  const seedTxt = seedInstruction ? seedInstruction : "null";

  // Nota: idioma de salida en ES neutro, conciso, listo para ejecutar.
  return `
Genera nuevas instrucciones de reto diario a partir de señales reales.

Semilla (mejor reto de ayer, puede ser null):
${seedTxt}

Estilos más usados ayer: [${stylesTxt}]
Tags más usados ayer: [${tagsTxt}]
Categoría con mejor desempeño: ${preferCategory ?? "global"}

Requisitos:
- Devuelve SOLO JSON válido (sin texto extra) con claves EXACTAS: ${JSON.stringify(wantCategories)}
- Cada valor: UNA línea, clara, accionable, grabable en <20s, sin emojis, sin hashtags, sin comillas.
- Mantén variedad entre categorías (no repitas literal la semilla).
- Integra de forma natural los estilos/tags más usados cuando tenga sentido.
- Español neutro, directo (imperativo amable).
  `.trim();
}

// ---------- LLM call ----------
async function callLLMToJson(promptSystem: string, promptUser: string): Promise<any | null> {
  const rsp = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.7,
    messages: [
      { role: "system", content: promptSystem },
      { role: "user", content: promptUser },
    ],
    // Pedimos “JSON-ish”; algunos modelos obedecen mejor con esta pista:
    response_format: { type: "json_object" as any },
  });

  const content = rsp.choices?.[0]?.message?.content || "";
  return extractJsonBlock(content);
}

// ---------- API principal ----------
export async function generateChallengeIdeas(input: IdeaParams): Promise<IdeaMap> {
  const wantCategories = (input.wantCategories || []).map((s) => (s || "").toString().trim()).filter(Boolean);
  if (wantCategories.length === 0) {
    throw new Error("generateChallengeIdeas: wantCategories no puede estar vacío.");
  }

  const topTags = uniqLower(input.topTags);
  const topStyles = uniqLower(input.topStyles);
  const preferCategory = (input.preferCategory || "global").toString();

  const sys = buildSystemPrompt();
  const usr = buildUserPrompt({
    seedInstruction: input.seedInstruction ?? null,
    topTags,
    topStyles,
    wantCategories,
    preferCategory,
  });

  let raw = null;
  try {
    raw = await callLLMToJson(sys, usr);
  } catch (err) {
    // Si el modelo falla o no hay clave, seguimos con fallback
    console.error("generateChallengeIdeas LLM error:", (err as Error)?.message);
  }

  const ideas = ensureAllCategories(raw, wantCategories, preferCategory, topTags);

  // post-proceso adicional: quitar líneas vacías o redundantes
  for (const k of Object.keys(ideas)) {
    let line = sanitizeLine(ideas[k]);
    // Pequeña heurística: evita que todas empiecen igual
    if (/^graba un clip corto/i.test(line) && input.seedInstruction) {
      line = line.replace(/^graba un clip corto/i, "Crea un clip corto");
    }
    ideas[k] = line;
  }

  return ideas;
}
