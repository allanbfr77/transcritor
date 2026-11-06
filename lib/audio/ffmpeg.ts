import { FFmpeg, type FFFSType } from "@ffmpeg/ffmpeg";
import { AppError } from "../types";

const CORE_VERSION = "0.12.10";
const CACHE_NAME = "transcritor-ffmpeg-v1";

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Baixa um recurso do CDN uma única vez e o mantém na Cache API. */
async function cachedBlobURL(url: string, mime: string): Promise<string> {
  try {
    if ("caches" in self) {
      const cache = await caches.open(CACHE_NAME);
      let res = await cache.match(url);
      if (!res) {
        const fresh = await fetch(url);
        if (!fresh.ok) throw new Error(`HTTP ${fresh.status}`);
        await cache.put(url, fresh.clone());
        res = fresh;
      }
      const buf = await res.arrayBuffer();
      return URL.createObjectURL(new Blob([buf], { type: mime }));
    }
  } catch {
    /* cai para o fetch direto */
  }
  const res = await fetch(url);
  if (!res.ok) throw new AppError("Não foi possível carregar o conversor de áudio (ffmpeg). Verifique sua conexão.", "ffmpeg-load");
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: mime }));
}

export function supportsPipeline(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: true }; // evita divergência na hidratação
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") {
    return { ok: false, reason: "Seu navegador não suporta WebAssembly e Web Workers. Use o Chrome ou o Edge atualizado no computador." };
  }
  return { ok: true };
}

export function isMultiThread(): boolean {
  return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
}

async function createInstance(): Promise<FFmpeg> {
  const sup = supportsPipeline();
  if (!sup.ok) throw new AppError(sup.reason!, "unsupported");
  const ff = new FFmpeg();
  const mt = isMultiThread();
  const pkg = mt ? "core-mt" : "core";
  const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/${pkg}@${CORE_VERSION}/dist/umd`;
  try {
    const coreURL = await cachedBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await cachedBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
    const workerURL = mt ? await cachedBlobURL(`${base}/ffmpeg-core.worker.js`, "text/javascript") : undefined;
    await ff.load({ coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Não foi possível carregar o conversor de áudio (ffmpeg). Verifique sua conexão e tente novamente.", "ffmpeg-load");
  }
  return ff;
}

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance?.loaded) return instance;
  if (!loading) {
    loading = createInstance()
      .then((ff) => {
        instance = ff;
        return ff;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** Encerra o worker do ffmpeg (cancela qualquer operação em curso). */
export function terminateFFmpeg() {
  const ff = instance;
  instance = null;
  try {
    ff?.terminate();
  } catch {
    /* ignore */
  }
}

/** Serializa o uso do ffmpeg, que só executa um comando por vez. */
export function withFFmpeg<T>(fn: (ff: FFmpeg) => Promise<T>): Promise<T> {
  const run = chain.then(async () => fn(await getFFmpeg()));
  chain = run.catch(() => undefined);
  return run;
}

let mountSeq = 0;

export interface MountedMedia {
  path: string;
  dispose: () => Promise<void>;
}

/** Monta o arquivo via WORKERFS: lido do disco sob demanda, sem copiar para a RAM. */
export async function mountMedia(ff: FFmpeg, data: Blob, ext = "bin"): Promise<MountedMedia> {
  const dir = `/in${++mountSeq}`;
  const name = `media.${ext.replace(/[^a-z0-9]/gi, "") || "bin"}`;
  try {
    await ff.createDir(dir);
    await ff.mount("WORKERFS" as FFFSType, { blobs: [{ name, data }] }, dir);
  } catch {
    throw new AppError(
      "Seu navegador não suporta a leitura de arquivos grandes sob demanda. Use o Chrome ou o Edge atualizado no computador.",
      "workerfs",
    );
  }
  return {
    path: `${dir}/${name}`,
    dispose: async () => {
      try {
        await ff.unmount(dir);
        await ff.deleteDir(dir);
      } catch {
        /* worker pode ter sido encerrado */
      }
    },
  };
}

/** Converte a saída de erro do ffmpeg em mensagem clara em pt-BR. */
export function translateFfmpegError(log: string, fallback = "Não foi possível processar o arquivo."): AppError {
  const l = log.toLowerCase();
  if (/does not contain any stream|matches no streams|stream map .* matches no|no audio|output file #0 does not contain/.test(l))
    return new AppError("Este vídeo não tem faixa de áudio.", "no-audio");
  if (/invalid data found|moov atom not found|error while decoding|corrupt/.test(l))
    return new AppError("O arquivo parece estar corrompido ou incompleto.", "corrupt");
  if (/unknown encoder|decoder .* not found|unsupported codec|could not find codec/.test(l))
    return new AppError("O codec de áudio deste arquivo não é suportado.", "codec");
  if (/out of memory|cannot enlarge memory|memory access out of bounds|oom/.test(l))
    return new AppError("Memória insuficiente para processar este arquivo. Feche outras abas ou use um arquivo menor.", "oom");
  if (/no space left|quota/.test(l))
    return new AppError("Espaço em disco insuficiente.", "disk");
  return new AppError(fallback, "ffmpeg");
}
