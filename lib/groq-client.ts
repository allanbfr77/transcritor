import { AppError, type Segment } from "./types";

interface GroqSegment {
  start: number;
  end: number;
  text: string;
  words?: { start: number; end: number; text: string }[];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    });
  });

/** Envia uma janela de áudio comprimida à rota /api/transcribe-groq (com retry em 429). */
export async function transcribeChunkGroq(
  blob: Blob,
  language: string,
  signal: AbortSignal | undefined,
  onWait?: (sec: number) => void,
): Promise<GroqSegment[]> {
  if (blob.size > 4 * 1024 * 1024) {
    throw new AppError("Um trecho de áudio passou de 4 MB e não pode ser enviado. Use o motor Local.", "too-large");
  }
  const delays = [8, 20, 45];
  for (let attempt = 0; ; attempt++) {
    const fd = new FormData();
    fd.append("file", blob, "chunk.ogg");
    if (language && language !== "auto") fd.append("language", language);
    let res: Response;
    try {
      res = await fetch("/api/transcribe-groq", { method: "POST", body: fd, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new AppError("Sem conexão com o servidor. Verifique sua internet ou troque para o motor Local.", "network");
    }
    if (res.ok) {
      const data = (await res.json()) as { segments?: GroqSegment[] };
      return data.segments ?? [];
    }
    if (res.status === 429) {
      if (attempt >= delays.length) {
        throw new AppError(
          "Limite de áudio por hora do plano gratuito da Groq atingido. Aguarde um pouco ou troque para o motor Local (privado, sem limite).",
          "rate-limit",
        );
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Math.min(120, Math.max(delays[attempt], isFinite(retryAfter) ? retryAfter : 0));
      onWait?.(wait);
      await sleep(wait * 1000, signal);
      continue;
    }
    let msg = "";
    try {
      msg = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 503)
      throw new AppError(msg || "A chave da Groq não está configurada ou é inválida.", "auth");
    if (res.status === 413) throw new AppError("O trecho de áudio é grande demais para enviar.", "too-large");
    if (res.status >= 500 && attempt < 2) {
      await sleep(3000 * (attempt + 1), signal);
      continue;
    }
    throw new AppError(msg || `Falha na transcrição pela Groq (código ${res.status}).`, "groq");
  }
}

export function toSegments(raw: GroqSegment[], idPrefix: string): Segment[] {
  return raw.map((s, i) => ({
    id: `${idPrefix}-${i}`,
    start: s.start,
    end: s.end,
    text: s.text,
    words: s.words,
  }));
}
