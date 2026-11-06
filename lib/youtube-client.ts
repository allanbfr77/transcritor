import { AppError, type Segment } from "./types";

export interface CaptionTrack {
  lang: string;
  name: string;
  auto: boolean;
}

export interface CaptionsResult {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  tracks: CaptionTrack[];
  selected: CaptionTrack;
  segments: Segment[];
}

export async function fetchCaptions(url: string, track?: CaptionTrack, signal?: AbortSignal): Promise<CaptionsResult> {
  const q = new URLSearchParams({ url });
  if (track) {
    q.set("lang", track.lang);
    q.set("kind", track.auto ? "asr" : "manual");
  }
  let res: Response;
  try {
    res = await fetch(`/api/youtube/captions?${q}`, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AppError("Sem conexão com o servidor.", "network");
  }
  const j = (await res.json().catch(() => ({}))) as CaptionsResult & { error?: string; code?: string };
  if (!res.ok) throw new AppError(j.error ?? "Não foi possível obter as legendas.", j.code ?? "youtube");
  return j;
}

/** Baixa o áudio via /api/youtube/audio (somente local, com yt-dlp). */
export async function fetchYoutubeAudio(
  url: string,
  videoId: string,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<File> {
  const res = await fetch(`/api/youtube/audio?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AppError(j.error ?? "Não foi possível extrair o áudio do YouTube.", "ytdlp");
  }
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value as BlobPart);
      loaded += value.byteLength;
      onProgress(loaded);
    }
  } catch (e) {
    if (signal.aborted) throw e;
    throw new AppError("A extração do áudio foi interrompida. Verifique o yt-dlp.", "ytdlp");
  }
  return new File(parts, `youtube-${videoId}.webm`, { type: "audio/webm" });
}

type YTPlayer = {
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

export type YTPlayerLike = YTPlayer;

interface YTGlobal {
  Player: new (el: HTMLElement | string, opts: { events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void } }) => YTPlayer;
}

let apiPromise: Promise<YTGlobal> | null = null;

export function loadYouTubeApi(): Promise<YTGlobal> {
  const w = window as unknown as { YT?: YTGlobal & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(w.YT!);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = () => {
        apiPromise = null;
        reject(new AppError("Não foi possível carregar o player do YouTube.", "yt-api"));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}
