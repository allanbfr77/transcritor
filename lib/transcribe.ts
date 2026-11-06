import { AudioSource, extractAudio, isAudioFile, probeMedia } from "./audio/extract";
import { mergeWindow, offsetSegments, planWindows } from "./audio/windows";
import { terminateFFmpeg } from "./audio/ffmpeg";
import { clearProgress, getProgress, saveProgress } from "./db";
import { toSegments, transcribeChunkGroq } from "./groq-client";
import { LOCAL_MODELS, LocalWhisper, detectWebGpu } from "./whisper";
import { AppError, isAbort, type EngineId, type ExtractedAudio, type JobProgress, type LocalModelId, type MediaProbe, type Segment } from "./types";

export interface RunOptions {
  file: File;
  engine: EngineId;
  model: LocalModelId;
  language: string;
  trackIndex: number;
  probe?: MediaProbe;
  /** áudio já extraído (ex.: vindo do Extrator) — pula a extração */
  audio?: ExtractedAudio;
  onProgress: (p: JobProgress) => void;
  onNotice?: (msg: string) => void;
  signal: AbortSignal;
}

export interface RunResult {
  segments: Segment[];
  duration: number;
  audio: Blob;
  device?: string;
}

function jobKey(o: RunOptions): string {
  const f = o.file;
  return [f.name, f.size, f.lastModified, o.engine, o.engine === "local" ? o.model : "groq", o.language, o.trackIndex].join("|");
}

export async function runTranscription(o: RunOptions): Promise<RunResult> {
  const { signal } = o;
  const check = () => {
    if (signal.aborted) throw new DOMException("Cancelado", "AbortError");
  };
  let whisper: LocalWhisper | null = null;
  let source: AudioSource | null = null;
  const onAbort = () => {
    terminateFFmpeg();
    whisper?.terminate();
  };
  signal.addEventListener("abort", onAbort);

  try {
    // 1) Leitura / extração
    let audioBlob: Blob;
    let audioName: string;
    let duration: number;
    if (o.audio) {
      audioBlob = o.audio.blob;
      audioName = o.audio.name;
      duration = o.audio.duration;
    } else if (isAudioFile(o.file)) {
      o.onProgress({ stage: "reading", label: "Lendo arquivo", percent: null });
      const probe = o.probe ?? (await probeMedia(o.file, o.file.name, signal));
      duration = probe.duration;
      audioBlob = o.file;
      audioName = o.file.name;
    } else {
      o.onProgress({ stage: "reading", label: "Lendo arquivo", percent: null });
      const probe = o.probe ?? (await probeMedia(o.file, o.file.name, signal));
      check();
      if (probe.tracks.length === 0) throw new AppError("Este vídeo não tem faixa de áudio.", "no-audio");
      const t0 = Date.now();
      const ex = await extractAudio(o.file, o.file.name, {
        format: "opus",
        quality: "transcription",
        trackIndex: o.trackIndex,
        probe,
        signal,
        onProgress: (p) => {
          const pct = p ?? 0;
          const el = (Date.now() - t0) / 1000;
          o.onProgress({
            stage: "extracting",
            label: `Extraindo áudio (${Math.round(pct)}%)`,
            percent: pct,
            etaSec: pct > 3 ? (el / pct) * (100 - pct) : null,
          });
        },
      });
      audioBlob = ex.blob;
      audioName = ex.name;
      duration = ex.duration || probe.duration;
    }
    check();
    if (!duration || !isFinite(duration)) duration = 1;

    // 2) Motor
    let device: string | undefined;
    if (o.engine === "local") {
      const model = LOCAL_MODELS.find((m) => m.id === o.model) ?? LOCAL_MODELS[1];
      const webgpu = await detectWebGpu();
      whisper = new LocalWhisper();
      o.onProgress({ stage: "model", label: "Baixando modelo (0%)", percent: 0, detail: "Na primeira vez; depois fica em cache no navegador." });
      await whisper.load(model, webgpu, (p) =>
        o.onProgress({ stage: "model", label: `Baixando modelo (${Math.round(p)}%)`, percent: p, detail: "Na primeira vez; depois fica em cache no navegador." }),
      );
      device = webgpu ? "WebGPU" : "WASM";
    }
    check();

    // 3) Janelas
    const windows = planWindows(duration);
    const key = jobKey(o);
    const saved = await getProgress(key);
    const done: Record<number, Segment[]> =
      saved && saved.total === windows.length ? { ...saved.windows } : {};
    const resumed = Object.keys(done).length;
    if (resumed > 0) o.onNotice?.(`Retomando de onde parou: ${resumed} de ${windows.length} janelas já transcritas.`);

    source = new AudioSource(audioBlob, audioName);
    let merged: Segment[] = [];
    const tWin: number[] = [];
    for (const w of windows) {
      check();
      const label = `Transcrevendo janela ${w.index + 1} de ${windows.length}`;
      const etaFor = (frac: number) => {
        const remaining = windows.length - w.index - frac;
        const avg = tWin.length ? tWin.reduce((a, b) => a + b, 0) / tWin.length : null;
        return avg != null ? remaining * avg : null;
      };
      let segs = done[w.index];
      if (!segs) {
        const tw = Date.now();
        o.onProgress({ stage: "transcribing", label, percent: (w.index / windows.length) * 100, etaSec: etaFor(0) });
        if (o.engine === "local" && whisper) {
          const pcm = await source.pcm(w.start, w.duration);
          check();
          const chunks = await whisper.transcribe(pcm, o.language, w.duration, (d, t) =>
            o.onProgress({
              stage: "transcribing",
              label: windows.length === 1 ? `Transcrevendo (${Math.round((d / t) * 100)}%)` : label,
              percent: ((w.index + d / t) / windows.length) * 100,
              etaSec: etaFor(d / t),
            }),
          );
          segs = offsetSegments(
            chunks.map((c, i) => ({ id: String(i), start: c.start, end: c.end, text: c.text })),
            w.start,
            `w${w.index}`,
          );
        } else {
          const blob = await source.compressed(w.start, w.duration);
          check();
          const raw = await transcribeChunkGroq(blob, o.language, signal, (sec) =>
            o.onProgress({ stage: "transcribing", label, percent: (w.index / windows.length) * 100, detail: `Limite da API atingido. Tentando novamente em ${sec} s…` }),
          );
          segs = offsetSegments(toSegments(raw, "g"), w.start, `w${w.index}`);
        }
        done[w.index] = segs;
        tWin.push((Date.now() - tw) / 1000);
        await saveProgress({ key, total: windows.length, windows: done, updatedAt: Date.now(), fileName: o.file.name });
      }
      merged = mergeWindow(merged, segs);
      o.onProgress({
        stage: "transcribing",
        label: windows.length === 1 ? "Transcrevendo (100%)" : label,
        percent: ((w.index + 1) / windows.length) * 100,
        etaSec: etaFor(1),
      });
    }

    o.onProgress({ stage: "finalizing", label: "Finalizando", percent: null });
    await clearProgress(key);
    merged = merged.map((s, i) => ({ ...s, id: `s${i}` }));
    if (merged.length === 0) {
      throw new AppError("Não foi detectada fala neste áudio.", "no-speech");
    }
    return { segments: merged, duration, audio: audioBlob, device };
  } catch (e) {
    if (signal.aborted || isAbort(e)) throw new DOMException("Cancelado", "AbortError");
    throw e;
  } finally {
    signal.removeEventListener("abort", onAbort);
    whisper?.terminate();
    await source?.dispose().catch(() => undefined);
  }
}
