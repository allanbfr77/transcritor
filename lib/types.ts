export interface Word {
  start: number;
  end: number;
  text: string;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  /** texto original, quando o trecho foi traduzido */
  original?: string;
  words?: Word[];
}

export type EngineId = "local" | "groq";
export type TranscriptOrigin = EngineId | "youtube";

export type SourceInfo =
  | { kind: "file"; name: string }
  | { kind: "drive"; name: string; url: string; fileId: string }
  | {
      kind: "youtube";
      title: string;
      channel: string;
      url: string;
      videoId: string;
      auto: boolean;
      lang: string;
    };

export interface Transcript {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  engine: TranscriptOrigin;
  model?: string;
  language?: string;
  source: SourceInfo;
  segments: Segment[];
}

export type LocalModelId = "fast" | "balanced" | "max";

export interface AppConfig {
  groq: boolean;
  gemini: boolean;
  aiProvider: "groq" | "gemini";
  aiConfigured: boolean;
  ytdlp: boolean;
}

export type JobStage = "model" | "reading" | "extracting" | "transcribing" | "finalizing";

export interface JobProgress {
  stage: JobStage;
  label: string;
  percent: number | null;
  detail?: string;
  etaSec?: number | null;
}

export interface AudioTrack {
  /** Índice entre as faixas de áudio (0, 1, 2...) */
  index: number;
  codec: string;
  lang?: string;
  title?: string;
  channels?: string;
}

export interface MediaProbe {
  duration: number;
  tracks: AudioTrack[];
  hasVideo: boolean;
}

export type AudioFormat = "mp3" | "m4a" | "opus" | "wav" | "flac";
export type AudioQuality = "transcription" | "voice" | "music";

export interface ExtractedAudio {
  blob: Blob;
  name: string;
  duration: number;
  mime: string;
  size: number;
  ext: string;
}

export class AppError extends Error {
  constructor(message: string, public code: string = "error") {
    super(message);
    this.name = "AppError";
  }
}

export function isAbort(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}
