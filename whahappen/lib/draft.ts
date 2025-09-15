// lib/draft.ts
export type DraftEdits = {
  trim: { startMs: number; endMs: number };
  overlays: Array<
    | { id: string; type: 'text'; text: string; color: string; fontSize: number; x: number; y: number; scale: number; rotation?: number; startMs: number; endMs: number }
    | { id: string; type: 'emoji'; emoji: string; x: number; y: number; scale: number; rotation?: number; startMs: number; endMs: number }
  >;
  audio: { url: string; title?: string; volume?: number } | null;
  voice: { url: string; startMs: number; endMs: number } | null;
  muteOriginal: boolean;
};

let _draft: DraftEdits | null = null;

export function saveDraft(d: DraftEdits) { _draft = JSON.parse(JSON.stringify(d)); }
export function getDraft(): DraftEdits | null { return _draft ? JSON.parse(JSON.stringify(_draft)) : null; }
export function clearDraft() { _draft = null; }
