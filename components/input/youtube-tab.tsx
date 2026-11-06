"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Captions } from "lucide-react";
import { fetchCaptions, fetchYoutubeAudio, type CaptionsResult, type CaptionTrack } from "@/lib/youtube-client";
import { parseYoutubeLink, type LinkKind } from "@/lib/url";
import { formatBytes, formatClock } from "@/lib/format";
import { isAbort, type AppConfig } from "@/lib/types";
import { Banner, Button, Select } from "../ui/primitives";
import { LinkField, MetaRow } from "./shared";

export function YoutubeTab({
  config,
  onCaptions,
  onAudio,
  onWrongKind,
  initialUrl,
}: {
  config: AppConfig | null;
  onCaptions: (r: CaptionsResult, url: string) => void;
  onAudio: (file: File, info: { videoId: string; url: string; title: string; channel: string }) => void;
  onWrongKind: (k: LinkKind, v: string) => void;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<CaptionsResult | null>(null);
  const [track, setTrack] = useState<CaptionTrack | null>(null);
  const [audioBytes, setAudioBytes] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = async (t?: CaptionTrack) => {
    setError(null);
    const p = parseYoutubeLink(url);
    if (!p.ok) {
      setRes(null);
      return setError(p.error);
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      const r = await fetchCaptions(p.url, t, ac.signal);
      setRes(r);
      setTrack(r.selected);
    } catch (e) {
      if (isAbort(e)) return;
      setRes(null);
      setError(e instanceof Error ? e.message : "Não foi possível obter as legendas.");
    } finally {
      setBusy(false);
    }
  };

  const whisper = async () => {
    const p = parseYoutubeLink(url);
    if (!p.ok) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setAudioBytes(0);
    try {
      const file = await fetchYoutubeAudio(p.url, p.videoId, setAudioBytes, ac.signal);
      onAudio(file, { videoId: p.videoId, url: p.url, title: res?.title ?? `YouTube ${p.videoId}`, channel: res?.channel ?? "" });
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "Falha ao extrair o áudio.");
    } finally {
      setAudioBytes(null);
    }
  };

  const ytdlp = !!config?.ytdlp;
  const whisperBtn =
    audioBytes != null ? (
      <Button onClick={() => abortRef.current?.abort()}>Cancelar ({formatBytes(audioBytes)})</Button>
    ) : (
      <Button onClick={whisper}>
        <AudioLines size={14} strokeWidth={1.75} />
        Transcrever o áudio com Whisper (precisão máxima)
      </Button>
    );

  return (
    <div className="space-y-3">
      <LinkField
        value={url}
        onChange={(v) => {
          setUrl(v);
          setRes(null);
        }}
        onSubmit={() => load()}
        kind="youtube"
        onWrongKind={onWrongKind}
        busy={busy}
        placeholder="Cole o link do vídeo no YouTube"
      />
      <p className="text-[12px] leading-5 text-fg-3">
        Usa as legendas do YouTube (manuais primeiro, depois automáticas). O vídeo em si não é baixado.
      </p>

      {res && track && (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4">
          <MetaRow
            items={[
              ["Título", res.title],
              ["Canal", res.channel || "—"],
              ["Duração", formatClock(res.duration)],
              ["Origem", `Legendas do YouTube${track.auto ? " (automáticas)" : ""}`],
            ]}
          />
          {res.tracks.length > 1 && (
            <label className="block text-[13px] text-fg-2">
              Idioma da legenda
              <Select
                label="Idioma da legenda"
                className="mt-1 w-full"
                value={`${track.lang}:${track.auto}`}
                onChange={(e) => {
                  const [lang, auto] = e.target.value.split(":");
                  void load(res.tracks.find((t) => t.lang === lang && String(t.auto) === auto));
                }}
              >
                {res.tracks.map((t) => (
                  <option key={`${t.lang}:${t.auto}`} value={`${t.lang}:${t.auto}`}>
                    {t.name}
                    {t.auto ? " (automática)" : ""}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Banner>A precisão depende da legenda original{track.auto ? ", gerada automaticamente pelo YouTube" : ""}.</Banner>
          <div className="flex flex-wrap justify-end gap-2">
            {ytdlp && whisperBtn}
            <Button variant="primary" onClick={() => onCaptions({ ...res, selected: track }, parseYoutubeLink(url).ok ? (parseYoutubeLink(url) as { url: string }).url : url)}>
              <Captions size={14} strokeWidth={1.75} />
              Usar legendas
            </Button>
          </div>
          {!ytdlp && (
            <p className="text-[12px] text-fg-3">Para transcrever o áudio, baixe o vídeo e envie na aba Arquivo.</p>
          )}
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <Banner tone="danger">{error}</Banner>
          {ytdlp ? (
            <div className="flex justify-end">{whisperBtn}</div>
          ) : (
            <p className="text-[12px] text-fg-3">Para transcrever o áudio, baixe o vídeo e envie na aba Arquivo.</p>
          )}
        </div>
      )}
    </div>
  );
}
