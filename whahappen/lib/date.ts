// lib/date.ts
export const todayKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`; // p.ej. 20250908
};

export const makeKey = (d: Date, dashed = false) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return dashed ? `${y}-${m}-${day}` : `${y}${m}${day}`;
};

// Hoy, con y sin guiones, y vecinos (por si hay desajuste de TZ)
export const candidateKeysForToday = () => {
  const now = new Date();
  const prev = new Date(now); prev.setDate(prev.getDate() - 1);
  const next = new Date(now); next.setDate(next.getDate() + 1);
  return [
    makeKey(now, false), makeKey(now, true),
    makeKey(prev, false), makeKey(prev, true),
    makeKey(next, false), makeKey(next, true),
  ];
};
