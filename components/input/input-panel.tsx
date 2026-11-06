"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, FileUp, HardDrive, CirclePlay } from "lucide-react";
import { isSupportedMedia, probeMedia } from "@/lib/audio/extract";
import { supportsPipeline } from "@/lib/audio/ffmpeg";
import { driveConfigured, type DriveMeta } from "@/lib/drive";
import type { CaptionsResult } from "@/lib/youtube-client";
import { isAbort, type AppConfig, type ExtractedAudio, type MediaProbe, type SourceInfo } from "@/lib/types";
import type { LinkKind } from "@/lib/url";
import { Banner, Segmented } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { DriveTab } from "./drive-tab";
import { ExtractorTab } from "./extractor-tab";
import { OptionsCard, type Settings } from "./options-card";
import { PendingCard } from "./pending-card";
import { DropZone, type StartRequest } from "./shared";
import { YoutubeTab } from "./youtube-tab";

type Tab = "file" | "drive" | "youtube" | "extract";

interface Pending {
  file: File;
  source: SourceInfo;
  cleanup?: () => Promise<void>;
  label: string;
}

export function InputPanel({
  config,
  settings,
  onSettings,
  webgpu,
  error,
  onStart,
  onCaptions,
}: {
  config: AppConfig | null;
  settings: Settings;
  onSettings: (s: Settings) => void;
  webgpu: boolean;
  error: string | null;
  onStart: (r: StartRequest) => void;
  onCaptions: (r: CaptionsResult, url: string) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("file");
  const [pending, setPending] = useState<Pending | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [perr, setPerr] = useState<string | null>(null);
  const [track, setTrack] = useState(0);
  const [carry, setCarry] = useState<{ drive?: string; youtube?: string }>({});
  const probeAbort = useRef<AbortController | null>(null);

  useEffect(() => () => probeAbort.current?.abort(), []);

  const stage = (file: File, source: SourceInfo, label: string, cleanup?: () => Promise<void>) => {
    probeAbort.current?.abort();
    const ac = new AbortController();
    probeAbort.current = ac;
    setPending({ file, source, cleanup, label });
    setProbe(null);
    setPerr(null);
    setTrack(0);
    setProbing(true);
    probeMedia(file, file.name, ac.signal)
      .then((p) => {
        if (p.tracks.length === 0) setPerr("Este vídeo não tem faixa de áudio.");
        setProbe(p);
      })
      .catch((e) => {
        if (!isAbort(e)) setPerr(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
      })
      .finally(() => setProbing(false));
  };

  const onFiles = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!isSupportedMedia(f)) {
      toast("Formato não suportado. Use mp4, mov, mkv, webm, avi, mp3, wav ou m4a.", "info");
      return;
    }
    stage(f, { kind: "file", name: f.name }, "Arquivo local");
  };

  const clearPending = () => {
    probeAbort.current?.abort();
    void pending?.cleanup?.();
    setPending(null);
    setProbe(null);
    setPerr(null);
  };

  const wrongKind = (k: LinkKind, v: string) => {
    if (k === "drive" || k === "youtube") {
      setCarry((c) => ({ ...c, [k]: v }));
      setTab(k);
      toast(k === "drive" ? "Link do Google Drive detectado. Troquei para a aba Google Drive." : "Link do YouTube detectado. Troquei para a aba YouTube.", "info");
    }
  };

  const start = () => {
    if (!pending) return;
    onStart({ file: pending.file, source: pending.source, probe: probe ?? undefined, trackIndex: track, cleanup: pending.cleanup });
    setPending(null);
    setProbe(null);
  };

  const sup = supportsPipeline();
  const driveTip = (
    <>
      Para usar o Google Drive, crie uma API key e um OAuth client ID gratuitos no Google Cloud Console e defina NEXT_PUBLIC_GOOGLE_API_KEY e NEXT_PUBLIC_GOOGLE_CLIENT_ID. Veja o README.
    </>
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 md:py-10">
      <div className="space-y-1">
        <h1 className="text-[20px] font-semibold tracking-tight">Nova transcrição</h1>
        <p className="text-[13px] text-fg-2">Envie um arquivo, carregue do Google Drive ou use as legendas de um vídeo do YouTube.</p>
      </div>

      <div className="overflow-x-auto">
        <Segmented<Tab>
          label="Origem da mídia"
          value={tab}
          onChange={(t) => {
            setTab(t);
          }}
          options={[
            { value: "file", label: "Arquivo", icon: <FileUp size={14} strokeWidth={1.75} /> },
            { value: "drive", label: "Google Drive", icon: <HardDrive size={14} strokeWidth={1.75} />, disabled: !driveConfigured, tip: driveConfigured ? undefined : driveTip },
            { value: "youtube", label: "YouTube", icon: <CirclePlay size={14} strokeWidth={1.75} /> },
            { value: "extract", label: "Extrair áudio", icon: <AudioLines size={14} strokeWidth={1.75} /> },
          ]}
        />
      </div>

      {!sup.ok && tab !== "youtube" && <Banner tone="danger">{sup.reason}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}

      {tab !== "extract" && !(pending && (tab === "file" || tab === "drive")) && (
        <OptionsCard settings={settings} onChange={onSettings} config={config} webgpu={webgpu} />
      )}

      {pending && (tab === "file" || tab === "drive") ? (
        <>
          <OptionsCard settings={settings} onChange={onSettings} config={config} webgpu={webgpu} />
          <PendingCard
            file={pending.file}
            probe={probe}
            probing={probing}
            error={perr}
            track={track}
            onTrack={setTrack}
            onStart={start}
            onCancel={clearPending}
            sourceLabel={pending.label}
          />
        </>
      ) : (
        <>
          {tab === "file" && <DropZone onFiles={onFiles} />}
          {tab === "drive" && (
            <DriveTab
              initialUrl={carry.drive}
              onWrongKind={wrongKind}
              onReady={(file: File, meta: DriveMeta, url: string, cleanup) =>
                stage(file, { kind: "drive", name: meta.name, url, fileId: meta.id }, "Google Drive", cleanup)
              }
            />
          )}
          {tab === "youtube" && (
            <YoutubeTab
              config={config}
              initialUrl={carry.youtube}
              onWrongKind={wrongKind}
              onCaptions={onCaptions}
              onAudio={(file, info) =>
                onStart({
                  file,
                  source: { kind: "youtube", title: info.title, channel: info.channel, url: info.url, videoId: info.videoId, auto: false, lang: "" },
                  trackIndex: 0,
                })
              }
            />
          )}
          {tab === "extract" && (
            <ExtractorTab
              onTranscribe={(audio: ExtractedAudio, original: File) =>
                onStart({ file: original, source: { kind: "file", name: original.name }, trackIndex: 0, audio })
              }
            />
          )}
        </>
      )}
    </div>
  );
}
