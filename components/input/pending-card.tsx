"use client";

import { FileAudio, FileVideo } from "lucide-react";
import { formatBytes, formatClock } from "@/lib/format";
import { isAudioFile } from "@/lib/audio/extract";
import type { MediaProbe } from "@/lib/types";
import { Banner, Button, Select } from "../ui/primitives";
import { MetaRow } from "./shared";

const TWO_GB = 2 * 1024 ** 3;

export function PendingCard({
  file,
  probe,
  probing,
  error,
  track,
  onTrack,
  onStart,
  onCancel,
  sourceLabel,
}: {
  file: File;
  probe: MediaProbe | null;
  probing: boolean;
  error: string | null;
  track: number;
  onTrack: (i: number) => void;
  onStart: () => void;
  onCancel: () => void;
  sourceLabel: string;
}) {
  const audio = isAudioFile(file);
  const Icon = audio ? FileAudio : FileVideo;
  return (
    <div className="space-y-4 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Icon size={28} strokeWidth={1.25} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{file.name}</p>
          <div className="mt-2">
            <MetaRow
              items={[
                ["Origem", sourceLabel],
                ["Tamanho", formatBytes(file.size)],
                ["Duração", probe ? formatClock(probe.duration) : probing ? "Lendo…" : "—"],
              ]}
            />
          </div>
        </div>
      </div>

      {file.size > TWO_GB && (
        <Banner tone="warning">
          Arquivo acima de 2 GB: o processo pode demorar, mas continua funcionando porque o vídeo é lido do disco sob demanda, sem carregar tudo na memória.
        </Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      {probe && probe.tracks.length > 1 && (
        <label className="block text-[13px] text-fg-2">
          Faixa de áudio
          <Select label="Faixa de áudio" className="mt-1 w-full" value={track} onChange={(e) => onTrack(Number(e.target.value))}>
            {probe.tracks.map((t) => (
              <option key={t.index} value={t.index}>
                Faixa {t.index + 1}
                {t.lang ? ` · ${t.lang}` : ""}
                {t.title ? ` · ${t.title}` : ""} ({t.codec}
                {t.channels ? `, ${t.channels}` : ""})
              </option>
            ))}
          </Select>
        </label>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Trocar arquivo
        </Button>
        <Button variant="primary" onClick={onStart} disabled={probing || !!error}>
          Transcrever
        </Button>
      </div>
    </div>
  );
}
