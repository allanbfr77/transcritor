/// <reference lib="webworker" />
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

interface Chunk {
  text: string;
  timestamp: [number, number | null];
}
interface AsrOutput {
  text: string;
  chunks?: Chunk[];
}
type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>;

export type WorkerIn =
  | { type: "load"; model: string; device: "webgpu" | "wasm"; large: boolean }
  | { type: "transcribe"; id: number; audio: Float32Array; language: string | null; duration: number };

export type WorkerOut =
  | { type: "download"; progress: number; file?: string }
  | { type: "ready"; device: string }
  | { type: "partial"; id: number; done: number; total: number }
  | { type: "result"; id: number; chunks: { start: number; end: number; text: string }[] }
  | { type: "error"; id?: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerOut) => ctx.postMessage(m);

let asr: Asr | null = null;

async function load(model: string, device: "webgpu" | "wasm", large: boolean) {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "progress" && p.file && p.total) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let l = 0;
      let t = 0;
      files.forEach((v) => {
        l += v.loaded;
        t += v.total;
      });
      post({ type: "download", progress: t ? (l / t) * 100 : 0, file: p.file });
    }
  };
  const dtype =
    device === "webgpu"
      ? large
        ? { encoder_model: "fp16", decoder_model_merged: "q4" }
        : { encoder_model: "fp32", decoder_model_merged: "fp32" }
      : "q8";
  const build = (dev: "webgpu" | "wasm", dt: unknown) =>
    (pipeline as unknown as (t: string, m: string, o: Record<string, unknown>) => Promise<unknown>)(
      "automatic-speech-recognition",
      model,
      { device: dev, dtype: dt, progress_callback },
    );
  try {
    asr = (await build(device, dtype)) as Asr;
    post({ type: "ready", device });
  } catch (e) {
    if (device === "webgpu" && !large) {
      // fallback para WASM quando o WebGPU falhar
      asr = (await build("wasm", "q8")) as Asr;
      post({ type: "ready", device: "wasm" });
      return;
    }
    throw e;
  }
}

async function transcribe(id: number, audio: Float32Array, language: string | null, duration: number) {
  if (!asr) throw new Error("Modelo não carregado.");
  const expected = Math.max(1, Math.ceil(duration / 25));
  let done = 0;
  const opts: Record<string, unknown> = {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    task: "transcribe",
    chunk_callback: () => {
      done++;
      post({ type: "partial", id, done: Math.min(done, expected), total: expected });
    },
  };
  if (language) opts.language = language;
  const out = await asr(audio, opts);
  const o = Array.isArray(out) ? out[0] : out;
  const chunks = (o.chunks ?? []).map((c) => ({
    start: c.timestamp[0] ?? 0,
    end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2,
    text: c.text,
  }));
  if (chunks.length === 0 && o.text?.trim()) chunks.push({ start: 0, end: duration, text: o.text });
  post({ type: "result", id, chunks });
}

ctx.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  try {
    if (m.type === "load") await load(m.model, m.device, m.large);
    else await transcribe(m.id, m.audio, m.language, m.duration);
  } catch (e) {
    post({ type: "error", id: m.type === "transcribe" ? m.id : undefined, message: e instanceof Error ? e.message : String(e) });
  }
};
