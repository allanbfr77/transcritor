"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Download, Trash2, X } from "lucide-react";
import { canCopyTrack, extractAudio, isAudioFile, isSupportedMedia, probeMedia } from "@/lib/audio/extract";
import { supportsPipeline } from "@/lib/audio/ffmpeg";
import { acquireWakeLock, releaseWakeLock } from "@/lib/wakelock";
import { download, formatBytes, formatClock, parseClock, uid } from "@/lib/format";
import { isAbort, type AudioFormat, type AudioQuality, type ExtractedAudio } from "@/lib/types";
import { Banner, Button, IconButton, ProgressBar, Select, Switch } from "../ui/primitives";
import { DropZone } from "./shared";

interface Item {
  id: string;
  file: File;
  status: "queued" | "processing" | "done" | "error";
  percent: number | null;
  label: string;
  result?: ExtractedAudio;
  url?: string;
  error?: string;
  skipped?: boolean;
  opts: { format: AudioFormat; quality: AudioQuality; copy: boolean; start?: number; end?: number };
}

const FORMATS: { value: AudioFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A / AAC" },
  { value: "opus", label: "Opus" },
  { value: "wav", label: "WAV (16 kHz mono)" },
  { value: "flac", label: "FLAC" },
];
const QUALITIES: { value: AudioQuality; label: string }[] = [
  { value: "transcription", label: "Otimizado para transcrição (mono, 16 kHz, 24 kbps)" },
  { value: "voice", label: "Voz (mono, 44,1 kHz, 64 kbps)" },
  { value: "music", label: "Música (estéreo, 192 kbps)" },
];

export function ExtractorTab({ onTranscribe }: { onTranscribe: (audio: ExtractedAudio, original: File) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<AudioFormat>("opus");
  const [quality, setQuality] = useState<AudioQuality>("transcription");
  const [copy, setCopy] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const running = useRef<string | null>(null);
  const itemsRef = useRef<Item[]>([]);

  const sup = supportsPipeline();

  const patch = useCallback((id: string, p: Partial<Item>) => {
    setItems((l) => {
      const n = l.map((i) => (i.id === id ? { ...i, ...p } : i));
      itemsRef.current = n;
      return n;
    });
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Libera URLs e cancela ao sair
  useEffect(
    () => () => {
      abortRef.current?.abort();
      itemsRef.current.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    },
    [],
  );

  // Processa a fila, um por vez
  useEffect(() => {
    if (running.current) return;
    const next = items.find((i) => i.status === "queued");
    if (!next) return;
    running.current = next.id;
    const ac = new AbortController();
    abortRef.current = ac;
    void (async () => {
      await acquireWakeLock();
      try {
        patch(next.id, { status: "processing", percent: null, label: "Lendo arquivo" });
        const o = next.opts;
        const trimmed = o.start != null || o.end != null;
        if (isAudioFile(next.file) && !trimmed) {
          const url = URL.createObjectURL(next.file);
          const probe = await probeMedia(next.file, next.file.name, ac.signal).catch(() => null);
          const result: ExtractedAudio = {
            blob: next.file,
            name: next.file.name,
            duration: probe?.duration ?? 0,
            mime: next.file.type || "audio/*",
            size: next.file.size,
            ext: next.file.name.split(".").pop() ?? "",
          };
          patch(next.id, { status: "done", result, url, skipped: true, percent: 100 });
          return;
        }
        const probe = await probeMedia(next.file, next.file.name, ac.signal);
        if (probe.tracks.length === 0) throw new Error("Este vídeo não tem faixa de áudio.");
        const result = await extractAudio(next.file, next.file.name, {
          format: o.format,
          quality: o.quality,
          copy: o.copy && canCopyTrack(probe.tracks[0]),
          start: o.start,
          end: o.end,
          probe,
          signal: ac.signal,
          onProgress: (p) => patch(next.id, { percent: p, label: `Extraindo áudio (${Math.round(p ?? 0)}%)` }),
        });
        patch(next.id, { status: "done", result, url: URL.createObjectURL(result.blob), percent: 100 });
      } catch (e) {
        patch(next.id, {
          status: "error",
          error: isAbort(e) ? "Cancelado." : e instanceof Error ? e.message : "Falha ao extrair o áudio.",
        });
      } finally {
        await releaseWakeLock();
        running.current = null;
        abortRef.current = null;
        // força reavaliar a fila
        setItems((l) => [...l]);
      }
    })();
  }, [items, patch]);

  const add = (files: File[]) => {
    setFormError(null);
    const s = start.trim() ? parseClock(start) : null;
    const e = end.trim() ? parseClock(end) : null;
    if ((start.trim() && s == null) || (end.trim() && e == null)) return setFormError("Tempo inválido. Use hh:mm:ss (ex.: 00:05:30).");
    if (s != null && e != null && e <= s) return setFormError("O fim do trecho precisa ser maior que o início.");
    const valid = files.filter(isSupportedMedia);
    if (valid.length < files.length) setFormError("Alguns arquivos foram ignorados: formato não suportado.");
    const created: Item[] = valid.map((file) => ({
      id: uid(),
      file,
      status: "queued",
      percent: null,
      label: "Na fila",
      opts: { format, quality, copy, start: s ?? undefined, end: e ?? undefined },
    }));
    setItems((l) => [...l, ...created]);
  };

  const remove = (it: Item) => {
    if (it.status === "processing") abortRef.current?.abort();
    if (it.url) URL.revokeObjectURL(it.url);
    setItems((l) => l.filter((i) => i.id !== it.id));
  };

  if (!sup.ok) return <Banner tone="danger">{sup.reason}</Banner>;

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-card border border-line bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px] text-fg-2">
            Formato
            <Select label="Formato de saída" className="mt-1 w-full" value={format} onChange={(e) => setFormat(e.target.value as AudioFormat)}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-[13px] text-fg-2">
            Qualidade
            <Select label="Qualidade" className="mt-1 w-full" value={quality} onChange={(e) => setQuality(e.target.value as AudioQuality)} disabled={format === "wav"}>
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-[13px] text-fg-2">
            Início do trecho (opcional)
            <input
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="00:00:00"
              inputMode="numeric"
              aria-label="Início do trecho"
              className="tnum mt-1 h-9 w-full rounded-control border border-line-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-3 max-md:h-11"
            />
          </label>
          <label className="block text-[13px] text-fg-2">
            Fim do trecho (opcional)
            <input
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="00:00:00"
              inputMode="numeric"
              aria-label="Fim do trecho"
              className="tnum mt-1 h-9 w-full rounded-control border border-line-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-3 max-md:h-11"
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px]">
          <span>
            Original (copiar a faixa sem recodificar)
            <span className="block text-[12px] text-fg-3">Instantâneo, quando o codec for AAC, MP3, Opus, Vorbis ou FLAC.</span>
          </span>
          <Switch checked={copy} onChange={setCopy} label="Original, sem recodificar" />
        </label>
      </div>

      {formError && <Banner tone="warning">{formError}</Banner>}

      <DropZone
        multiple
        onFiles={add}
        title="Arraste vídeos ou áudios para extrair o áudio"
        hint="Vários arquivos entram em fila e são processados um por vez"
      />

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Fila de extração">
          {items.map((it) => (
            <li key={it.id} className="rounded-card border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{it.file.name}</p>
                <span className="tnum shrink-0 text-[12px] text-fg-3">{formatBytes(it.file.size)}</span>
                <IconButton label={it.status === "processing" ? "Cancelar" : "Remover"} onClick={() => remove(it)}>
                  {it.status === "processing" ? <X size={15} strokeWidth={1.75} /> : <Trash2 size={15} strokeWidth={1.75} />}
                </IconButton>
              </div>
              {(it.status === "queued" || it.status === "processing") && (
                <div className="mt-2 space-y-1">
                  <ProgressBar percent={it.status === "queued" ? 0 : it.percent} />
                  <p className="text-[12px] text-fg-3">{it.label}</p>
                </div>
              )}
              {it.status === "error" && <p className="mt-2 text-[13px] text-danger">{it.error}</p>}
              {it.status === "done" && it.result && (
                <div className="mt-2 space-y-2">
                  <p className="tnum text-[13px] text-fg-2">
                    {it.skipped ? "Áudio já pronto · " : ""}
                    {it.result.duration > 0 ? `${formatClock(it.result.duration)} · ` : ""}
                    {formatBytes(it.file.size)} → <span className="font-medium text-fg">{formatBytes(it.result.size)}</span>
                  </p>
                  {it.url && <audio src={it.url} controls className="h-9 w-full" />}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" onClick={() => download(it.result!.name, it.result!.blob, it.result!.mime)}>
                      <Download size={14} strokeWidth={1.75} />
                      Baixar áudio
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => onTranscribe(it.result!, it.file)}>
                      <AudioLines size={14} strokeWidth={1.75} />
                      Transcrever este áudio
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
