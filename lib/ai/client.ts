import { formatClock } from "../format";
import { AppError, type Segment } from "../types";

export type TaskId = "summary" | "points" | "chapters" | "fix" | "quotes" | "translate";

const BASE =
  "Você é um assistente de análise de transcrições de vídeo. Responda sempre em português do Brasil, de forma objetiva, sem introduções desnecessárias. " +
  "A transcrição traz marcações de tempo no formato [hh:mm:ss] no início de cada trecho. Quando citar um momento, use exatamente esse formato [hh:mm:ss].";

const TASKS: Record<TaskId, { label: string; map: (extra?: string) => string; reduce?: string; mapOnly?: boolean }> = {
  summary: {
    label: "Resumo",
    map: () => "Resuma este trecho da transcrição em até 8 tópicos curtos, mantendo fatos, nomes e números importantes.",
    reduce: "Combine as notas parciais abaixo em um resumo final coeso do vídeo inteiro: um parágrafo de visão geral seguido de tópicos com as ideias centrais.",
  },
  points: {
    label: "Pontos principais",
    map: () => "Liste os pontos principais deste trecho em tópicos curtos.",
    reduce: "Combine as listas parciais abaixo em uma lista única e sem repetições dos pontos principais do vídeo, em ordem de aparição.",
  },
  chapters: {
    label: "Capítulos",
    map: () =>
      "Identifique as mudanças de assunto neste trecho. Para cada uma, escreva uma linha no formato: [hh:mm:ss] Título curto do capítulo. Use os tempos reais da transcrição.",
    reduce:
      "Com base nas linhas parciais abaixo, produza a lista final de capítulos do vídeo, uma por linha, no formato [hh:mm:ss] Título. Una capítulos muito próximos e mantenha ordem cronológica.",
  },
  fix: {
    label: "Texto corrigido",
    map: () =>
      "Corrija a pontuação, a ortografia e a capitalização do texto, sem alterar o sentido nem resumir. Mantenha as marcações [hh:mm:ss] como estão no início de cada linha. Devolva apenas o texto corrigido.",
    mapOnly: true,
  },
  quotes: {
    label: "Citações",
    map: () =>
      "Extraia as citações mais marcantes e informativas deste trecho, literais, cada uma em uma linha no formato: [hh:mm:ss] “citação”.",
    reduce: "Dos candidatos abaixo, selecione as 10 melhores citações, sem repetição, mantendo o formato [hh:mm:ss] “citação”.",
  },
  translate: {
    label: "Tradução",
    map: (lang) =>
      `Traduza o texto para ${lang ?? "inglês"}, fielmente. Mantenha as marcações [hh:mm:ss] no início de cada linha. Devolva apenas a tradução.`,
    mapOnly: true,
  },
};

export const TASK_LABELS = Object.fromEntries(Object.entries(TASKS).map(([k, v]) => [k, v.label])) as Record<TaskId, string>;

/** ~14 mil caracteres (~4 mil tokens) por bloco: cabe com folga nos limites do plano gratuito. */
const CHUNK_CHARS = 14_000;
const DIRECT_LIMIT = 16_000;

export function transcriptLines(segments: Segment[]): string[] {
  return segments.map((s) => `[${formatClock(s.start)}] ${s.text}`);
}

function chunkLines(lines: string[], size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const l of lines) {
    if (n + l.length > size && cur.length) {
      out.push(cur.join("\n"));
      cur = [];
      n = 0;
    }
    cur.push(l);
    n += l.length + 1;
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    });
  });

/** Chama /api/ai com streaming; faz retry em 429. */
export async function streamAI(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  signal: AbortSignal,
  onText: (full: string) => void,
  onWait?: (sec: number) => void,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, messages }),
      signal,
    }).catch((e) => {
      if (signal.aborted) throw e;
      throw new AppError("Sem conexão com o servidor.", "network");
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(60, Number(res.headers.get("retry-after")) || 15 * (attempt + 1));
      onWait?.(wait);
      await sleep(wait * 1000, signal);
      continue;
    }
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AppError(j.error ?? `Falha ao consultar a IA (${res.status}).`, res.status === 503 ? "no-key" : "ai");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      onText(full);
    }
    return full;
  }
}

export interface RunInfo {
  onText: (text: string) => void;
  onNotice: (msg: string | null) => void;
  signal: AbortSignal;
}

/** Executa uma tarefa; para transcrições longas usa map-reduce em blocos. */
export async function runTask(task: TaskId, segments: Segment[], run: RunInfo, extra?: string): Promise<string> {
  const def = TASKS[task];
  const lines = transcriptLines(segments);
  const total = lines.join("\n");
  const system = BASE;
  if (total.length <= DIRECT_LIMIT) {
    return streamAI(system, [{ role: "user", content: `${def.map(extra)}\n\nTranscrição:\n${total}` }], run.signal, run.onText, (s) =>
      run.onNotice(`Limite do plano gratuito atingido. Tentando de novo em ${s} s…`),
    );
  }
  const chunks = chunkLines(lines);
  run.onNotice(`Transcrição longa: processando em ${chunks.length} partes para respeitar os limites do plano gratuito. Isso pode levar alguns minutos.`);
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    run.onNotice(`Processando parte ${i + 1} de ${chunks.length}…`);
    const part = await streamAI(
      system,
      [{ role: "user", content: `${def.map(extra)}\n\n(Parte ${i + 1} de ${chunks.length})\nTranscrição:\n${chunks[i]}` }],
      run.signal,
      (t) => {
        if (def.mapOnly) run.onText([...parts, t].join("\n\n"));
      },
      (s) => run.onNotice(`Limite do plano gratuito atingido. Tentando de novo em ${s} s…`),
    );
    parts.push(part.trim());
    if (i < chunks.length - 1) await sleep(1500, run.signal);
  }
  if (def.mapOnly) {
    run.onNotice(null);
    return parts.join("\n\n");
  }
  run.onNotice("Combinando as partes…");
  let notes = parts.join("\n\n");
  // Se as notas ainda forem grandes, reduz em rodadas.
  let guard = 0;
  while (notes.length > DIRECT_LIMIT && guard++ < 3) {
    const sub = chunkLines(notes.split("\n"), CHUNK_CHARS);
    const reduced: string[] = [];
    for (const s of sub) {
      reduced.push(
        (await streamAI(system, [{ role: "user", content: `${def.reduce}\n\nNotas:\n${s}` }], run.signal, () => undefined)).trim(),
      );
      await sleep(1500, run.signal);
    }
    notes = reduced.join("\n\n");
  }
  const final = await streamAI(system, [{ role: "user", content: `${def.reduce}\n\nNotas parciais:\n${notes}` }], run.signal, run.onText, (s) =>
    run.onNotice(`Limite do plano gratuito atingido. Tentando de novo em ${s} s…`),
  );
  run.onNotice(null);
  return final;
}

/** Contexto para o chat: transcrição inteira se couber; senão, notas condensadas com timestamps. */
export async function buildChatContext(
  segments: Segment[],
  signal: AbortSignal,
  onNotice: (msg: string | null) => void,
): Promise<string> {
  const lines = transcriptLines(segments);
  const total = lines.join("\n");
  if (total.length <= 24_000) return total;
  const chunks = chunkLines(lines);
  onNotice(`Transcrição longa: preparando o contexto em ${chunks.length} partes (feito uma única vez).`);
  const notes: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onNotice(`Preparando contexto: parte ${i + 1} de ${chunks.length}…`);
    notes.push(
      (
        await streamAI(
          BASE,
          [
            {
              role: "user",
              content: `Condense este trecho em notas detalhadas (fatos, nomes, números, argumentos), cada nota iniciando com o tempo [hh:mm:ss] correspondente.\n\n${chunks[i]}`,
            },
          ],
          signal,
          () => undefined,
          (s) => onNotice(`Limite do plano gratuito atingido. Tentando de novo em ${s} s…`),
        )
      ).trim(),
    );
    await sleep(1500, signal);
  }
  onNotice(null);
  return notes.join("\n");
}

export function chatSystem(context: string, condensed: boolean): string {
  return (
    `${BASE}\n\nVocê responde perguntas sobre o vídeo cuja ${condensed ? "versão condensada (notas com tempo)" : "transcrição"} está abaixo. ` +
    `Baseie-se apenas nesse conteúdo; se a resposta não estiver nele, diga isso. Cite os momentos relevantes com [hh:mm:ss].\n\n---\n${context}`
  );
}

export const TIMESTAMP_RE = /\[?\b(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\b\]?/g;

export function clockToSec(s: string): number {
  const p = s.split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}
