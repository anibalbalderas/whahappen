// functions/src/schedule-challenges.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebaseAdmin";
import { generateChallengeIdeas, OPENAI_SECRET } from "./ai";

/**
 * Ajustes clave:
 * - DocID de challenges = YYYYMMDD (compat con UI vieja)
 * - Campo key (ISO) = YYYY-MM-DD
 * - Incluye generatedAt, basedOn (ahora SIEMPRE null), signals
 * - Sanitiza '#' en instrucciones
 * - Ya NO se toma como referencia el reto más usado: todo se genera por categoría desde cero
 */

const TZ = "America/Matamoros";
const CATEGORIES = ["global", "caritativo", "picaro", "creativo", "rebelde", "troll", "chill"];

/** Sanitiza cualquier # restante */
function stripHash(s: string) {
  return (s || "").replace(/#\w+/g, "").trim();
}

function endOfDayTZ(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function keyIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function keyCompact(d: Date) {
  return keyIso(d).replace(/-/g, "");
}
function todayInTZ(tz: string) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find(p => p.type === "year")?.value);
  const m = Number(parts.find(p => p.type === "month")?.value) - 1;
  const d = Number(parts.find(p => p.type === "day")?.value);
  return new Date(y, m, d, 0, 0, 0, 0);
}

/**
 * Señales “blandas” desde la app (tags/estilos top) — si no existen, seguimos.
 * Esto NO trae instructivo previo; solo señales.
 */
async function getSoftSignals() {
  try {
    const snap = await db.collection("analytics").doc("signals").get();
    if (!snap.exists) return { topTags: [], topStyles: [] };
    const data = snap.data() || {};
    return {
      topTags: Array.isArray(data.topTags) ? data.topTags.slice(0, 5) : [],
      topStyles: Array.isArray(data.topStyles) ? data.topStyles.slice(0, 5) : [],
    };
  } catch {
    return { topTags: [], topStyles: [] };
  }
}

/**
 * Crea el documento en /challenges/{YYYYMMDD}
 * Estructura:
 * {
 *   key, date, tz, generatedAt, basedOn: null,
 *   signals: { topTags, topStyles },
 *   global: { instruction },
 *   categories: { [cat]: { instruction } }
 * }
 */
async function writeChallengeDoc(date: Date, ideasByCat: Record<string, string>, signals: any) {
  const key = keyIso(date);
  const id = keyCompact(date);
  const ref = db.collection("challenges").doc(id);

  const doc: any = {
    key,
    date: Timestamp.fromDate(endOfDayTZ(date)),
    tz: TZ,
    generatedAt: Timestamp.now(),
    basedOn: null, // 🔔 por compat: ya no se usa
    signals,
    global: { instruction: stripHash(ideasByCat["global"] ?? "Cuenta algo épico en 15s.") },
    categories: {},
  };

  for (const c of CATEGORIES.filter((c) => c !== "global")) {
    const line = ideasByCat[c] ?? `Reto ${c}: sube tu take en <30s.`;
    doc.categories[c] = { instruction: stripHash(line) };
  }

  await ref.set(doc, { merge: false });
}

export const scheduleChallenges = onSchedule(
  {
    schedule: "every day 08:00",
    timeZone: TZ,
    secrets: [OPENAI_SECRET],
    concurrency: 1,
    retryCount: 0,
  },
  async () => {
    // Generamos para HOY (en TZ) y para los próximos 2 días para ir cubiertos
    const base = todayInTZ(TZ);
    const daysToGenerate = 3;

    const signals = await getSoftSignals();

    for (let i = 0; i < daysToGenerate; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);

      const key = keyCompact(d);
      const ref = db.collection("challenges").doc(key);
      const exists = await ref.get();
      if (exists.exists) continue; // ya existe, no lo sobrescribimos

      // 🎯 Generación 100% por categoría, desde cero (sin reto previo)
      const ideas = await generateChallengeIdeas({
        wantCategories: CATEGORIES,
        topTags: signals.topTags,
        topStyles: signals.topStyles,
        // preferCategory: opcional – podrías rotarla si quieres
      });

      await writeChallengeDoc(d, ideas, signals);
    }
  }
);
