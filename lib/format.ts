import type { Segment, Transcript } from "./types";

const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, "0");

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

export function formatShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function srtTime(sec: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toTxt(segments: Segment[], withTimestamps: boolean): string {
  return segments
    .map((s) => (withTimestamps ? `[${formatClock(s.start)}] ${s.text}` : s.text))
    .join("\n");
}

export function toSrt(segments: Segment[]): string {
  return (
    segments
      .map((s, i) => `${i + 1}\n${srtTime(s.start, ",")} --> ${srtTime(s.end, ",")}\n${s.text}\n`)
      .join("\n")
  );
}

export function toVtt(segments: Segment[]): string {
  return (
    "WEBVTT\n\n" +
    segments
      .map((s) => `${srtTime(s.start, ".")} --> ${srtTime(s.end, ".")}\n${s.text}\n`)
      .join("\n")
  );
}

export function toJson(t: Transcript): string {
  return JSON.stringify(
    {
      title: t.title,
      duration: t.duration,
      engine: t.engine,
      model: t.model,
      language: t.language,
      source: t.source,
      segments: t.segments.map(({ start, end, text, words }) => ({ start, end, text, words })),
    },
    null,
    2,
  );
}

export interface Paragraph {
  start: number;
  segments: Segment[];
}

/** Agrupa segmentos em parágrafos por pausas longas ou tamanho máximo. */
export function groupParagraphs(segments: Segment[], gap = 1.8, maxChars = 700): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: Paragraph | null = null;
  let chars = 0;
  let prevEnd = 0;
  for (const s of segments) {
    if (!cur || s.start - prevEnd >= gap || chars > maxChars) {
      cur = { start: s.start, segments: [] };
      out.push(cur);
      chars = 0;
    }
    cur.segments.push(s);
    chars += s.text.length;
    prevEnd = s.end;
  }
  return out;
}

export function formatBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1).replace(".", ",")} ${u[i]}`;
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "";
  if (sec < 60) return `cerca de ${Math.max(1, Math.round(sec))} s restantes`;
  const m = Math.round(sec / 60);
  if (m < 60) return `cerca de ${m} min restantes`;
  return `cerca de ${Math.floor(m / 60)} h ${m % 60} min restantes`;
}

/** "hh:mm:ss", "mm:ss" ou segundos -> segundos. Retorna null se inválido. */
export function parseClock(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

export function download(filename: string, content: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "transcricao";
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
