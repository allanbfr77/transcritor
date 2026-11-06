import { AppError, type LocalModelId } from "./types";
import type { WorkerIn, WorkerOut } from "../workers/whisper.worker";

export interface ModelInfo {
  id: LocalModelId;
  label: string;
  description: string;
  repo: string;
  needsWebGpu: boolean;
}

export const LOCAL_MODELS: ModelInfo[] = [
  { id: "fast", label: "Rápido", description: "Menor e mais veloz (~75 MB). Boa para áudio limpo.", repo: "Xenova/whisper-base", needsWebGpu: false },
  { id: "balanced", label: "Equilibrado", description: "Bom equilíbrio entre velocidade e precisão (~250 MB).", repo: "Xenova/whisper-small", needsWebGpu: false },
  { id: "max", label: "Máxima precisão", description: "Whisper large-v3-turbo (~800 MB). Requer WebGPU.", repo: "onnx-community/whisper-large-v3-turbo", needsWebGpu: true },
];

export const LANGUAGES: { code: string; name: string; whisper: string }[] = [
  { code: "auto", name: "Detectar automaticamente", whisper: "" },
  { code: "pt", name: "Português", whisper: "portuguese" },
  { code: "en", name: "Inglês", whisper: "english" },
  { code: "es", name: "Espanhol", whisper: "spanish" },
  { code: "fr", name: "Francês", whisper: "french" },
  { code: "de", name: "Alemão", whisper: "german" },
  { code: "it", name: "Italiano", whisper: "italian" },
  { code: "ja", name: "Japonês", whisper: "japanese" },
  { code: "zh", name: "Chinês", whisper: "chinese" },
  { code: "ko", name: "Coreano", whisper: "korean" },
  { code: "ru", name: "Russo", whisper: "russian" },
  { code: "nl", name: "Holandês", whisper: "dutch" },
  { code: "pl", name: "Polonês", whisper: "polish" },
  { code: "tr", name: "Turco", whisper: "turkish" },
  { code: "ar", name: "Árabe", whisper: "arabic" },
  { code: "hi", name: "Hindi", whisper: "hindi" },
  { code: "uk", name: "Ucraniano", whisper: "ukrainian" },
];

export async function detectWebGpu(): Promise<boolean> {
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } };
    if (!nav.gpu) return false;
    return !!(await nav.gpu.requestAdapter());
  } catch {
    return false;
  }
}

export interface LocalChunk {
  start: number;
  end: number;
  text: string;
}

/** Cliente do worker do Whisper (Transformers.js). */
export class LocalWhisper {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (c: LocalChunk[]) => void; reject: (e: Error) => void; onPartial?: (done: number, total: number) => void }
  >();
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private onDownload?: (p: number) => void;

  async load(model: ModelInfo, webgpu: boolean, onDownload?: (percent: number) => void): Promise<void> {
    if (model.needsWebGpu && !webgpu) {
      throw new AppError("O modelo de máxima precisão exige WebGPU, que não está disponível neste navegador. Escolha outro modelo ou use o Chrome/Edge atualizado.", "webgpu");
    }
    this.onDownload = onDownload;
    this.worker = new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => this.handle(ev.data);
    this.worker.onerror = (ev) => this.fail(new AppError(`Falha no mecanismo local: ${ev.message || "erro desconhecido"}`, "worker"));
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const msg: WorkerIn = { type: "load", model: model.repo, device: webgpu ? "webgpu" : "wasm", large: model.id === "max" };
    this.worker.postMessage(msg);
    await ready;
  }

  private handle(m: WorkerOut) {
    switch (m.type) {
      case "download":
        this.onDownload?.(m.progress);
        break;
      case "ready":
        this.readyResolve?.();
        break;
      case "partial":
        this.pending.get(m.id)?.onPartial?.(m.done, m.total);
        break;
      case "result": {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.resolve(m.chunks);
        break;
      }
      case "error": {
        const err = new AppError(translateLocalError(m.message), "local");
        if (m.id != null) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          p?.reject(err);
        } else this.fail(err);
      }
    }
  }

  private fail(e: Error) {
    this.readyReject?.(e);
    this.pending.forEach((p) => p.reject(e));
    this.pending.clear();
  }

  transcribe(audio: Float32Array, languageCode: string, duration: number, onPartial?: (done: number, total: number) => void): Promise<LocalChunk[]> {
    const id = ++this.seq;
    const lang = LANGUAGES.find((l) => l.code === languageCode)?.whisper || null;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onPartial });
      const msg: WorkerIn = { type: "transcribe", id, audio, language: lang, duration };
      this.worker!.postMessage(msg, [audio.buffer]);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new DOMException("Cancelado", "AbortError"));
  }
}

function translateLocalError(msg: string): string {
  const l = msg.toLowerCase();
  if (/out of memory|oom|allocation|memory/.test(l))
    return "Memória insuficiente para o modelo escolhido. Tente um modelo menor (Rápido) ou feche outras abas.";
  if (/webgpu|gpu/.test(l)) return "Falha ao usar a GPU (WebGPU). Tente outro modelo ou outro navegador.";
  if (/fetch|network|failed to load|load failed/.test(l))
    return "Não foi possível baixar o modelo. Verifique sua conexão e tente novamente.";
  return `Falha na transcrição local: ${msg}`;
}
