import type { Segment } from "../types";

export const WINDOW_SEC = 600;
export const OVERLAP_SEC = 2;

export interface AudioWindow {
  index: number;
  start: number;
  /** duração a decodificar (inclui a sobreposição no final) */
  duration: number;
}

export function planWindows(totalSec: number, windowSec = WINDOW_SEC, overlap = OVERLAP_SEC): AudioWindow[] {
  const total = Math.max(totalSec, 0.1);
  const count = Math.max(1, Math.ceil(total / windowSec));
  const out: AudioWindow[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * windowSec;
    out.push({ index: i, start, duration: Math.min(windowSec + overlap, total - start) });
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Junta os segmentos de uma nova janela aos já aceitos, descartando o que
 * foi coberto pela sobreposição (ponto médio antes do fim já transcrito ou
 * texto idêntico ao último trecho).
 */
export function mergeWindow(prev: Segment[], next: Segment[]): Segment[] {
  if (prev.length === 0) return [...next];
  const lastEnd = prev[prev.length - 1].end;
  const tail = new Set(prev.slice(-3).map((s) => norm(s.text)));
  const kept = next.filter((s) => {
    const mid = (s.start + s.end) / 2;
    if (mid < lastEnd - 0.05) return false;
    const n = norm(s.text);
    if (n && tail.has(n) && s.start < lastEnd + OVERLAP_SEC) return false;
    return true;
  });
  return [...prev, ...kept];
}

export function offsetSegments(segs: Segment[], offset: number, idPrefix: string): Segment[] {
  return segs
    .filter((s) => s.text.trim().length > 0)
    .map((s, i) => ({
      id: `${idPrefix}-${i}`,
      start: s.start + offset,
      end: Math.max(s.end, s.start) + offset,
      text: s.text.trim(),
      words: s.words?.map((w) => ({ start: w.start + offset, end: w.end + offset, text: w.text })),
    }));
}
