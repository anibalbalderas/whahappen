// lib/ranking.ts
export type RankCtx = {
  now?: number;              // Date.now()
  me?: string | null;        // uid actual
  preferredTag?: string;     // si quieres boost por tag
  followingSet?: Set<string>;// uids que sigo (opcional)
  terms?: string[];          // palabras de búsqueda (lowercase)
};

export type PostLike = {
  id: string;
  uid: string;
  createdAt?: any; // Firestore Timestamp
  likesCount?: number;
  commentsCount?: number;
  caption?: string;
  challengeTag?: string;
  tag?: string;
  challenge?: string;
};

const HALF_LIFE_HRS = 18; // media-vida de popularidad
const W_LIKE = 1.0;
const W_COMMENT = 1.6;
const BOOST_FOLLOWING = 0.6;
const BOOST_MINE = 0.5;
const BOOST_TAG_MATCH = 0.4;
const BOOST_TERM = 0.3; // por término que haga match en caption/tag

function toMs(t?: any) {
  if (!t) return 0;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  return +t || 0;
}

function termScoreFor(p: PostLike, terms?: string[]) {
  if (!terms || terms.length === 0) return 0;
  const text = `${p.caption ?? ''} ${p.challengeTag ?? p.tag ?? p.challenge ?? ''}`.toLowerCase();
  let s = 0;
  for (const term of terms) {
    if (!term) continue;
    if (text.includes(term)) s += BOOST_TERM;
  }
  return s;
}

export function rankPosts<T extends PostLike>(posts: T[], ctx: RankCtx = {}): T[] {
  const now = ctx.now ?? Date.now();
  const out = posts.map((p) => {
    const created = toMs(p.createdAt);
    const ageHrs = Math.max(0, (now - created) / 3600_000);
    const decay = Math.pow(0.5, ageHrs / HALF_LIFE_HRS);
    const base = (W_LIKE * (p.likesCount || 0)) + (W_COMMENT * (p.commentsCount || 0));
    const social =
      (ctx.me && ctx.me === p.uid ? BOOST_MINE : 0) +
      (ctx.followingSet?.has?.(p.uid) ? BOOST_FOLLOWING : 0);
    const tag = (ctx.preferredTag && (p.challengeTag === ctx.preferredTag || p.tag === ctx.preferredTag)) ? BOOST_TAG_MATCH : 0;
    const text = termScoreFor(p, ctx.terms);
    const jitter = Math.random() * 0.05; // desempate suave

    const score = (base * decay) + social + tag + text + jitter;
    return { ...p, _rank: score as number } as T & { _rank: number };
  });

  out.sort((a: any, b: any) => (b._rank ?? 0) - (a._rank ?? 0));
  return out as T[];
}
