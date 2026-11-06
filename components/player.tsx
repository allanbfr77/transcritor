"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { loadYouTubeApi, type YTPlayerLike } from "@/lib/youtube-client";
import { Button } from "./ui/primitives";

export type MediaHandle =
  | { kind: "element"; url: string; isVideo: boolean; name: string }
  | { kind: "youtube"; videoId: string }
  | null;

export interface PlayerApi {
  seek: (t: number, play?: boolean) => void;
  toggle: () => void;
  skip: (delta: number) => void;
}

interface Props {
  media: MediaHandle;
  onTime: (t: number) => void;
  onReattach?: () => void;
  className?: string;
}

export const Player = forwardRef<PlayerApi, Props>(function Player({ media, onTime, onReattach, className }, ref) {
  const el = useRef<HTMLMediaElement | null>(null);
  const yt = useRef<YTPlayerLike | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ytError, setYtError] = useState(false);
  const onTimeRef = useRef(onTime);
  useEffect(() => {
    onTimeRef.current = onTime;
  });

  useImperativeHandle(
    ref,
    () => ({
      seek: (t, play = true) => {
        if (yt.current) {
          yt.current.seekTo(t, true);
          if (play) yt.current.playVideo();
        } else if (el.current) {
          el.current.currentTime = t;
          if (play) void el.current.play().catch(() => undefined);
        }
      },
      toggle: () => {
        if (yt.current) {
          const playing = yt.current.getPlayerState() === 1;
          if (playing) yt.current.pauseVideo();
          else yt.current.playVideo();
        } else if (el.current) {
          if (el.current.paused) void el.current.play().catch(() => undefined);
          else el.current.pause();
        }
      },
      skip: (d) => {
        if (yt.current) yt.current.seekTo(Math.max(0, yt.current.getCurrentTime() + d), true);
        else if (el.current) el.current.currentTime = Math.max(0, el.current.currentTime + d);
      },
    }),
    [],
  );

  // YouTube IFrame Player API
  const videoId = media?.kind === "youtube" ? media.videoId : null;
  useEffect(() => {
    if (!videoId) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !iframeRef.current) return;
        const p = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => {
              yt.current = p;
              timer = setInterval(() => onTimeRef.current(p.getCurrentTime()), 250);
            },
          },
        });
      })
      .catch(() => setYtError(true));
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      try {
        yt.current?.destroy();
      } catch {
        /* ignore */
      }
      yt.current = null;
    };
  }, [videoId]);

  if (!media) {
    return (
      <div className={`flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-surface p-4 text-center ${className ?? ""}`}>
        <p className="text-[13px] text-fg-2">A mídia não está anexada. Reanexe o arquivo para reproduzir.</p>
        {onReattach && (
          <Button size="sm" onClick={onReattach}>
            <Paperclip size={14} strokeWidth={1.75} />
            Reanexar mídia
          </Button>
        )}
      </div>
    );
  }

  if (media.kind === "youtube") {
    const origin = typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : "";
    const credentialless = { credentialless: "" } as Record<string, string>;
    return (
      <div className={`aspect-video w-full overflow-hidden rounded-card border border-line bg-black ${className ?? ""}`}>
        {ytError ? (
          <div className="flex size-full items-center justify-center p-4 text-center text-[13px] text-white/80">
            Não foi possível carregar o player do YouTube.
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={media.videoId}
            title="Player do YouTube"
            className="size-full"
            src={`https://www.youtube.com/embed/${media.videoId}?enablejsapi=1&rel=0&playsinline=1&origin=${origin}`}
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            {...credentialless}
          />
        )}
      </div>
    );
  }

  const common = {
    src: media.url,
    controls: true,
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => onTime(e.currentTarget.currentTime),
    onSeeked: (e: React.SyntheticEvent<HTMLMediaElement>) => onTime(e.currentTarget.currentTime),
  };
  return media.isVideo ? (
    <video
      key={media.url}
      ref={(n) => {
        el.current = n;
      }}
      {...common}
      playsInline
      className={`aspect-video w-full rounded-card border border-line bg-black ${className ?? ""}`}
    />
  ) : (
    <div className={`rounded-card border border-line bg-surface p-3 ${className ?? ""}`}>
      <p className="mb-2 truncate text-[13px] text-fg-2">{media.name}</p>
      <audio
        key={media.url}
        ref={(n) => {
          el.current = n;
        }}
        {...common}
        className="w-full"
      />
    </div>
  );
});
