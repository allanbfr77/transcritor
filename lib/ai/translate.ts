import { streamAI } from "./client";
import type { Segment } from "../types";

const PT_WORDS = new Set([
  "de", "que", "não", "para", "com", "uma", "os", "as", "você", "é", "em", "um", "se", "mais", "como", "mas", "foi", "ele", "ela", "por", "da", "do", "na", "no", "eu", "isso", "tem", "são", "então", "está", "também", "muito", "ao", "dos", "das",
]);

/** Heurística simples: proporção de palavras comuns do português numa amostra. */
export function looksPortuguese(segments: Segment[]): boolean {
  const sample = segments.slice(0, 80).map((s) => s.text).join(" ").toLowerCase();
  const words = sample.match(/[\p{L}]+/gu) ?? [];
  if (words.length < 8) return false;
  const hits = words.filter((w) => PT_WORDS.has(w)).length;
  return hits / words.length > 0.14;
}

const SYSTEM =
  "Você é um tradutor profissional. Traduza para português do Brasil, de forma natural e fiel, cada linha numerada recebida. " +
  "Responda SOMENTE com as linhas traduzidas, no formato exato `N: texto`, mantendo os mesmos números, uma por linha, sem unir nem dividir linhas e sem comentários. " +
  "Se uma linha já estiver em português, repita-a igual.";

const BATCH_CHARS = 5000;
const BATCH_MAX = 60;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    });
  });

/** Traduz os trechos para pt-BR mantendo os tempos. O texto original fica em `original`. */
export async function translateSegments(
  segments: Segment[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  onNotice?: (msg: string | null) => void,
): Promise<Segment[]> {
  const out = segments.map((s) => ({ ...s }));
  const batches: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  segments.forEach((s, i) => {
    if (cur.length && (chars + s.text.length > BATCH_CHARS || cur.length >= BATCH_MAX)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += s.text.length;
  });
  if (cur.length) batches.push(cur);

  onProgress(0, batches.length);
  for (let b = 0; b < batches.length; b++) {
    const idxs = batches[b];
    const prompt = idxs.map((si, k) => `${k + 1}: ${segments[si].text.replace(/\s*\n\s*/g, " ")}`).join("\n");
    const text = await streamAI(
      SYSTEM,
      [{ role: "user", content: prompt }],
      signal,
      () => undefined,
      (s) => onNotice?.(`Limite do plano gratuito atingido. Tentando de novo em ${s} s…`),
    );
    onNotice?.(null);
    const map = new Map<number, string>();
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(\d+)\s*[:.)-]\s*(.*)$/);
      if (m && m[2].trim()) map.set(Number(m[1]), m[2].trim());
    }
    idxs.forEach((si, k) => {
      const t = map.get(k + 1);
      if (t && t !== segments[si].text) {
        out[si] = { ...segments[si], text: t, original: segments[si].text, words: undefined };
      }
    });
    onProgress(b + 1, batches.length);
    if (b < batches.length - 1) await sleep(800, signal);
  }
  return out;
}
