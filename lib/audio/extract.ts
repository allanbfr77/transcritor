import type { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  AppError,
  isAbort,
  type AudioFormat,
  type AudioQuality,
  type AudioTrack,
  type ExtractedAudio,
  type MediaProbe,
} from "../types";
import { mountMedia, terminateFFmpeg, translateFfmpegError, withFFmpeg, type MountedMedia } from "./ffmpeg";

export const AUDIO_EXTS = ["mp3", "wav", "m4a", "opus", "flac", "ogg", "aac"];
export const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "avi"];

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isAudioFile(f: { name: string; type?: string }): boolean {
  return (f.type?.startsWith("audio/") ?? false) || AUDIO_EXTS.includes(extOf(f.name));
}

export function isSupportedMedia(f: { name: string; type?: string }): boolean {
  const e = extOf(f.name);
  return isAudioFile(f) || VIDEO_EXTS.includes(e) || (f.type?.startsWith("video/") ?? false);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
}

/** Registra um listener de log e devolve função para remover e obter as linhas. */
function captureLog(ff: FFmpeg) {
  const lines: string[] = [];
  const cb = ({ message }: { type: string; message: string }) => {
    lines.push(message);
    if (lines.length > 400) lines.shift();
  };
  ff.on("log", cb);
  return {
    lines,
    stop: () => ff.off("log", cb),
  };
}

function parseClockLog(s: string): number {
  const m = s.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

export function parseProbeLog(lines: string[]): MediaProbe {
  let duration = 0;
  const tracks: AudioTrack[] = [];
  let hasVideo = false;
  let cur: AudioTrack | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const d = line.match(/^\s*Duration:\s*([\d:.]+)/);
    if (d) duration = parseClockLog(d[1]);
    const s = line.match(/^\s*Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([^)]*)\))?[^:]*:\s*(Audio|Video|Subtitle|Data|Attachment):\s*(.*)$/);
    if (s) {
      cur = null;
      if (s[2] === "Video" && !/attached pic/i.test(s[3])) hasVideo = true;
      if (s[2] === "Audio") {
        const rest = s[3];
        const codec = rest.split(/[ ,(]/)[0];
        const ch = rest.match(/,\s*(mono|stereo|5\.1(?:\([^)]*\))?|\d+ channels)/);
        cur = {
          index: tracks.length,
          codec,
          lang: s[1] && s[1] !== "und" ? s[1] : undefined,
          channels: ch?.[1],
        };
        tracks.push(cur);
      }
      continue;
    }
    const t = line.match(/^\s+title\s*:\s*(.+)$/);
    if (t && cur) cur.title = t[1].trim();
  }
  return { duration, tracks, hasVideo };
}

export async function probeMedia(data: Blob, name: string, signal?: AbortSignal): Promise<MediaProbe> {
  throwIfAborted(signal);
  return withFFmpeg(async (ff) => {
    const m = await mountMedia(ff, data, extOf(name));
    const log = captureLog(ff);
    try {
      await ff.exec(["-hide_banner", "-i", m.path]);
      const info = parseProbeLog(log.lines);
      if (info.tracks.length === 0 && !info.hasVideo && info.duration === 0) {
        throw translateFfmpegError(log.lines.join("\n"), "Não foi possível ler este arquivo. Verifique se é um vídeo ou áudio válido.");
      }
      return info;
    } finally {
      log.stop();
      await m.dispose();
    }
  });
}

interface QualitySpec {
  channels: number;
  rate: number;
  kbps: number;
}

const QUALITY: Record<AudioQuality, QualitySpec> = {
  transcription: { channels: 1, rate: 16000, kbps: 24 },
  voice: { channels: 1, rate: 44100, kbps: 64 },
  music: { channels: 2, rate: 44100, kbps: 192 },
};

interface FormatSpec {
  ext: string;
  mime: string;
  codec: string[];
  /** taxas de amostragem permitidas pelo codec (undefined = qualquer) */
  rates?: number[];
  lossy: boolean;
}

const FORMATS: Record<AudioFormat, FormatSpec> = {
  mp3: { ext: "mp3", mime: "audio/mpeg", codec: ["-c:a", "libmp3lame"], lossy: true },
  m4a: { ext: "m4a", mime: "audio/mp4", codec: ["-c:a", "aac"], lossy: true },
  opus: { ext: "ogg", mime: "audio/ogg", codec: ["-c:a", "libopus"], rates: [8000, 12000, 16000, 24000, 48000], lossy: true },
  wav: { ext: "wav", mime: "audio/wav", codec: ["-c:a", "pcm_s16le"], lossy: false },
  flac: { ext: "flac", mime: "audio/flac", codec: ["-c:a", "flac"], lossy: false },
};

const COPY_CONTAINER: Record<string, { ext: string; mime: string }> = {
  aac: { ext: "m4a", mime: "audio/mp4" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  opus: { ext: "ogg", mime: "audio/ogg" },
  vorbis: { ext: "ogg", mime: "audio/ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
};

export function canCopyTrack(track: AudioTrack | undefined): boolean {
  return !!track && track.codec in COPY_CONTAINER;
}

export interface ExtractOptions {
  format: AudioFormat;
  quality: AudioQuality;
  /** copiar a faixa sem recodificar, quando possível */
  copy?: boolean;
  start?: number;
  end?: number;
  trackIndex?: number;
  probe?: MediaProbe;
  onProgress?: (percent: number | null) => void;
  signal?: AbortSignal;
}

function buildEncodeArgs(opts: ExtractOptions): { args: string[]; spec: { ext: string; mime: string } } {
  const f = FORMATS[opts.format];
  const q = QUALITY[opts.quality];
  let rate = opts.format === "wav" ? 16000 : q.rate;
  let channels = opts.format === "wav" ? 1 : q.channels;
  if (f.rates && !f.rates.includes(rate)) rate = 48000;
  if (opts.format === "wav") channels = 1;
  const args = [...f.codec, "-ac", String(channels), "-ar", String(rate)];
  if (f.lossy) args.push("-b:a", `${q.kbps}k`);
  if (opts.format === "opus") args.push("-application", "voip");
  return { args, spec: { ext: f.ext, mime: f.mime } };
}

/**
 * Extrai somente o áudio. O arquivo é montado via WORKERFS (leitura sob
 * demanda do disco) — o vídeo inteiro nunca é carregado na memória.
 */
export async function extractAudio(input: Blob, name: string, opts: ExtractOptions): Promise<ExtractedAudio> {
  throwIfAborted(opts.signal);
  const track = opts.probe?.tracks[opts.trackIndex ?? 0];
  const copy = !!opts.copy && canCopyTrack(track);
  const onAbort = () => terminateFFmpeg();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    return await withFFmpeg(async (ff) => {
      throwIfAborted(opts.signal);
      const m = await mountMedia(ff, input, extOf(name));
      const log = captureLog(ff);
      const outName = `out-${Date.now()}`;
      let outPath = "";
      const total = opts.probe?.duration ?? 0;
      const span = (opts.end ?? total) - (opts.start ?? 0);
      const progressCb = ({ time }: { progress: number; time: number }) => {
        if (span > 0 && time > 0) opts.onProgress?.(Math.min(99, (time / 1e6 / span) * 100));
      };
      ff.on("progress", progressCb);
      try {
        const spec = copy ? COPY_CONTAINER[track!.codec] : buildEncodeArgs(opts).spec;
        outPath = `/${outName}.${spec.ext}`;
        const args = ["-hide_banner", "-nostdin"];
        if (opts.start && opts.start > 0) args.push("-ss", String(opts.start));
        args.push("-i", m.path);
        if (opts.end != null && opts.end > (opts.start ?? 0)) args.push("-t", String(opts.end - (opts.start ?? 0)));
        args.push("-vn", "-map", `0:a:${opts.trackIndex ?? 0}`);
        if (copy) args.push("-c:a", "copy");
        else args.push(...buildEncodeArgs(opts).args);
        args.push("-y", outPath);
        opts.onProgress?.(0);
        const code = await ff.exec(args);
        throwIfAborted(opts.signal);
        if (code !== 0) throw translateFfmpegError(log.lines.join("\n"), "Falha ao extrair o áudio.");
        const data = await ff.readFile(outPath);
        if (typeof data === "string" || data.byteLength === 0) {
          throw new AppError("Este vídeo não tem faixa de áudio.", "no-audio");
        }
        const blob = new Blob([data as BlobPart], { type: spec.mime });
        opts.onProgress?.(100);
        const duration = span > 0 ? span : total;
        return {
          blob,
          name: `${name.replace(/\.[^.]+$/, "")}.${spec.ext}`,
          duration,
          mime: spec.mime,
          size: blob.size,
          ext: spec.ext,
        };
      } finally {
        ff.off("progress", progressCb);
        log.stop();
        if (outPath) await ff.deleteFile(outPath).catch(() => undefined);
        await m.dispose();
      }
    });
  } catch (e) {
    if (opts.signal?.aborted && !isAbort(e)) throw new DOMException("Cancelado", "AbortError");
    if (e instanceof Error && /terminate/i.test(e.message)) throw new DOMException("Cancelado", "AbortError");
    throw e;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Fonte de áudio montada uma vez (WORKERFS) para recortar janelas
 * de ~10 min sob demanda, sem decodificar o áudio inteiro.
 */
export class AudioSource {
  private mounted: MountedMedia | null = null;
  private ffRef: FFmpeg | null = null;

  constructor(private blob: Blob, private name: string) {}

  private async ensure(ff: FFmpeg): Promise<MountedMedia> {
    if (this.mounted && this.ffRef === ff) return this.mounted;
    this.mounted = await mountMedia(ff, this.blob, extOf(this.name));
    this.ffRef = ff;
    return this.mounted;
  }

  private async run(start: number, duration: number, outArgs: string[], outExt: string): Promise<Uint8Array> {
    return withFFmpeg(async (ff) => {
      const m = await this.ensure(ff);
      const log = captureLog(ff);
      const out = `/win-${Date.now()}.${outExt}`;
      try {
        const code = await ff.exec([
          "-hide_banner",
          "-nostdin",
          "-ss",
          String(Math.max(0, start)),
          "-t",
          String(duration),
          "-i",
          m.path,
          "-vn",
          "-map",
          "0:a:0",
          ...outArgs,
          "-y",
          out,
        ]);
        if (code !== 0) throw translateFfmpegError(log.lines.join("\n"), "Falha ao ler um trecho do áudio.");
        const data = await ff.readFile(out);
        if (typeof data === "string") throw new AppError("Falha ao ler um trecho do áudio.", "ffmpeg");
        return data;
      } finally {
        log.stop();
        await ff.deleteFile(out).catch(() => undefined);
      }
    });
  }

  /** PCM mono 16 kHz Float32 de uma janela. */
  async pcm(start: number, duration: number): Promise<Float32Array> {
    const data = await this.run(start, duration, ["-ac", "1", "-ar", "16000", "-f", "f32le"], "f32");
    const copy = data.slice();
    return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
  }

  /** Janela comprimida (opus 24 kbps mono 16 kHz), bem abaixo de 4 MB. */
  async compressed(start: number, duration: number): Promise<Blob> {
    const data = await this.run(
      start,
      duration,
      ["-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", "-application", "voip", "-f", "ogg"],
      "ogg",
    );
    return new Blob([data as BlobPart], { type: "audio/ogg" });
  }

  async dispose() {
    const m = this.mounted;
    this.mounted = null;
    if (m) await m.dispose();
  }
}
