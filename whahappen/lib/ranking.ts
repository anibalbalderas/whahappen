// lib/ranking.ts
// ------------------------------------------------------------
// Ranking que NO cuenta tus propias interacciones.
// Usa *_FromOthersCount si existen; si no, cae a los contadores totales.
// Incluye decaimiento temporal y pequeños boosts contextuales.
// ------------------------------------------------------------

export type PostLike = {
  id: string;
  uid: string; // autor del post
  createdAt?: any; // Firestore Timestamp | number | string
  caption?: string;
  challengeTag?: string;
  tag?: string;
  likesCount?: number;
  commentsCount?: number;
  likesFromOthersCount?: number;
  commentsFromOthersCount?: number;
  viewsCount?: number;
  viewsFromOthersCount?: number;
};

export type RankCtx = {
  now?: number;                 // Date.now() por defecto
  me?: string | null;           // uid actual
  followingSet?: Set<string>;   // autores que sigo
  preferredTag?: string | null; // para feeds por reto/categoría
  terms?: string[];             // búsqueda libre
};

// Ajusta estos pesos según lo necesites
const HALF_LIFE_HRS = 18;

const W_LIKE = 1.0;
const W_COMMENT = 1.6;
// Si quieres sumar vistas al score, descomenta la línea de "viewsEff" abajo y este peso
// const W_VIEW = 0.15;

const BOOST_FOLLOWING = 0.6;
const BOOST_TAG_MATCH = 0.4;
const BOOST_TERM = 0.3;

function safeNum(x: any) {
  return typeof x === 'number' && isFinite(x) ? x : 0;
}

function toMs(t?: any) {
  if (!t) return 0;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (t?.seconds && t?.nanoseconds) {
    // Timestamp-like
    return t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);
  }
  if (typeof t === 'number') return t;
  const n = +new Date(t);
  return isFinite(n) ? n : 0;
}

function termScoreFor(p: PostLike, terms?: string[]) {
  if (!terms || terms.length === 0) return 0;
  const text = `${p.caption ?? ''} ${p.challengeTag ?? p.tag ?? ''}`.toLowerCase();
  let s = 0;
  for (const term of terms) {
    const t = (term || '').toLowerCase().trim();
    if (!t) continue;
    if (text.includes(t)) s += BOOST_TERM;
  }
  return s;
}

export function rankPosts<T extends PostLike>(posts: T[], ctx: RankCtx = {}): (T & { _rank: number })[] {
  const now = ctx.now ?? Date.now();

  const out = posts.map((p) => {
    // Solo interacciones de otros si están disponibles
    const likesEff = safeNum((p as any).likesFromOthersCount ?? p.likesCount);
    const commentsEff = safeNum((p as any).commentsFromOthersCount ?? p.commentsCount);
    // Si decides incluir vistas, descomenta:
    // const viewsEff = safeNum((p as any).viewsFromOthersCount ?? p.viewsCount);

    const created = toMs(p.createdAt);
    const ageHrs = Math.max(0, (now - created) / 3600_000);
    const decay = Math.pow(0.5, ageHrs / HALF_LIFE_HRS);

    const base =
      (W_LIKE * likesEff) +
      (W_COMMENT * commentsEff);
      // + (W_VIEW * viewsEff);

    // Social/contexto
    const isMine = !!(ctx.me && ctx.me === p.uid);
    const followingBoost = (ctx.followingSet?.has?.(p.uid) ? BOOST_FOLLOWING : 0);
    const tagBoost = (ctx.preferredTag &&
      (p.challengeTag === ctx.preferredTag || p.tag === ctx.preferredTag)) ? BOOST_TAG_MATCH : 0;

    // No hay boost para mis propios posts (explícito, 0)
    const mineBoost = isMine ? 0 : 0;

    const textBoost = termScoreFor(p, ctx.terms);

    // Pequeña aleatoriedad para romper empates sin mover demasiado el orden
    const jitter = Math.random() * 0.05;

    const score = (base * decay) + followingBoost + tagBoost + mineBoost + textBoost + jitter;

    return { ...(p as any), _rank: score as number } as T & { _rank: number };
  });

  out.sort((a, b) => (b._rank ?? 0) - (a._rank ?? 0));
  return out;
}
