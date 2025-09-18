import { defineSecret } from "firebase-functions/params";

// 👉 Secreto exportado desde aquí para reutilizar en otras funciones
export const OPENAI_SECRET = defineSecret("OPENAI_API_KEY");

export type IdeaParams = {
  /** Ya no usamos reto previo: lo dejamos por compatibilidad pero lo ignoramos */
  seedInstruction?: string | null;
  /** Señales blandas de la app para tono / tendencias */
  topTags?: string[];
  topStyles?: string[];
  /** Categorías a generar (debe incluir "global") */
  wantCategories: string[];
  /** Hint de tono preferido (no obligatorio) */
  preferCategory?: string;
};

export type IdeaMap = Record<string, string>;

/** Puedes cambiar el modelo si te conviene */
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Prompt por categoría: busca el límite de lo permitido (sin actividades ilegales,
 * autolesiones, odio, desnudos, ni riesgos graves). Ganchos en 3s, fácil de grabar,
 * 15–30s, alta probabilidad de participación/viralidad.
 */
const CATEGORY_BRIEFS: Record<string, string> = {
  global:
    "Un reto universal y de participación masiva, grabable en 15–20s, con un hook fuerte en los primeros 3s. Cero materiales raros, cero logística.",
  caritativo:
    "Pequeño gesto positivo o micro-acción solidaria filmable al momento. Enfocado en amabilidad cotidiana.",
  picaro:
    "Pícaro con picante hard (doble sentido), sexual explícito, acoso, que incomode seriamente a otras personas.",
  creativo:
    "Creatividad inmediata con objetos comunes o solo con la cámara. Truco visual, transición, lip sync original o mini performance.",
  rebelde:
    "Actitud rebelde: cuestiona normas (vandalismo, riesgos, confrontaciones con desconocidos).",
  troll:
    "Humor travieso/auto-troleo: broma sobre uno mismo o situación personal; humilla a otros e invade privacidad.",
  chill:
    "Reto relajado/ASMR/light: baja barrera de entrada, se siente agradable de ver y fácil de hacer sin salir de casa.",
};

/** Plantillas de estilo para reforzar el “edge” sin cruzar líneas */
const STYLE_GUIDELINES = [
  "máximo 20 segundos, ideal 15–20",
  "gancho contundente en los primeros 3 segundos",
  "sin música con copyright, no uses marcas registradas ni rostros de terceros sin consentimiento",
  "debe poderse grabar con un teléfono sin accesorios especiales",
];

function buildSystemPrompt() {
  return [
    "Eres un curador de retos virales para una app de videos cortos.",
    "Tu objetivo: ideas ultra grabables, con gancho, al filo de lo permitido.",
    "Entrega una sola línea por categoría, directa, accionable y sin hashtags.",
    `Reglas: ${STYLE_GUIDELINES.map((x) => `- ${x}`).join("\n")}`,
  ].join("\n");
}

function buildUserPrompt(input: IdeaParams) {
  const tags = (input.topTags ?? []).slice(0, 3).map((t) => `#${t}`).join(" ");
  const styles = (input.topStyles ?? []).slice(0, 3).join(", ");
  const prefer = input.preferCategory && input.preferCategory !== "global"
    ? `Preferencia de tono: ${input.preferCategory}.`
    : "";

  const briefs = input.wantCategories.map((c) => `- ${c}: ${CATEGORY_BRIEFS[c] ?? "Reto breve y grabable."}`).join("\n");

  return [
    "Genera 1 instrucción por cada categoría solicitada.",
    "No uses el reto previo como base. Crea TODO desde cero por categoría.",
    "Responde SOLO JSON: { \"categoria\": \"instrucción\" }",
    prefer,
    tags ? `Tendencias: ${tags}` : "",
    styles ? `Estilos sugeridos: ${styles}` : "",
    "Categorías y briefs:",
    briefs,
  ].filter(Boolean).join("\n");
}

/** Llama a OpenAI Chat Completions y retorna el texto */
async function callOpenAI(system: string, user: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY no configurada");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.9,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json() as any;
  const out = data?.choices?.[0]?.message?.content ?? "";
  return out;
}

/** Limpia, acorta y asegura formato apto para UI */
function sanitizeLine(s: string): string {
  if (!s) return "";
  let out = s.replace(/\s+/g, " ").trim();

  // quitar hashtags, emojis ruidosos y comillas envolventes
  out = out.replace(/#\w+/g, "");
  out = out.replace(/[“”"']/g, "");
  out = out.replace(/[\u{1F300}-\u{1FAFF}]/gu, "");

  // longitud máxima
  if (out.length > 220) out = out.slice(0, 220).trim();

  return out;
}

function fallbackLine(category: string): string {
  // Fallback minimalista por categoría
  switch (category) {
    case "global":
      return "Cuenta, en <20s, el micro-momento más épico de tu día con un giro inesperado en los primeros 3s.";
    case "caritativo":
      return "Comparte un mini-gesto amable que puedas hacer ahora mismo y reta a otros a repetirlo (todo en <20s).";
    case "picaro":
      return "Haz un doble sentido ligero sobre algo cotidiano y remátalo con una cara o giro sorpresivo (sin incomodar).";
    case "creativo":
      return "Cambia de escena con un tap de cámara y revela algo transformado en <20s.";
    case "rebelde":
      return "Rompe UNA regla personal inofensiva (p. ej. usar calcetines distintos) y muestra tu actitud en <15s.";
    case "troll":
      return "Auto-troléate con algo que siempre te sale mal y conviértelo en chiste breve (<15s).";
    case "chill":
      return "Graba 10s de algo hipnótico y relajante de tu entorno y agrega un susurro o texto calmante.";
    default:
      return "Crea un clip <20s con un gancho fuerte en 3s, seguro y fácil de grabar.";
  }
}

function extractJson(s: string): any | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    // intenta extraer bloque de código JSON
    const m = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
    if (m) {
      try { return JSON.parse(m[1]); } catch { /* ignore */ }
    }
    return null;
  }
}

function ensureAll(raw: any, want: string[]): IdeaMap {
  const out: IdeaMap = {};
  for (const c of want) {
    const v = typeof raw?.[c] === "string" ? raw[c] : null;
    out[c] = sanitizeLine(v || fallbackLine(c));
  }
  return out;
}

/**
 * API pública: genera 1 instrucción por categoría, SIN basarse en nada previo.
 */
export async function generateChallengeIdeas(input: IdeaParams): Promise<IdeaMap> {
  const want = Array.from(new Set(input.wantCategories)).filter(Boolean);

  const sys = buildSystemPrompt();
  const usr = buildUserPrompt({ ...input, seedInstruction: null });

  let raw: any = null;
  try {
    const txt = await callOpenAI(sys, usr);
    raw = extractJson(txt);
  } catch (e) {
    console.error("generateChallengeIdeas error:", (e as Error).message);
  }

  const ideas = ensureAll(raw, want);
  // retoque final por si el modelo repitió estructuras demasiado genéricas
  for (const k of Object.keys(ideas)) {
    let line = ideas[k];
    // remap de verbos demasiado genéricos
    line = line.replace(/^graba un clip corto/i, "Crea un clip corto");
    ideas[k] = sanitizeLine(line);
  }
  return ideas;
}
