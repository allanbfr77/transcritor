"use client";

import { useRef, useState, type ReactNode } from "react";
import { Link2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { detectKind, type LinkKind } from "@/lib/url";
import { Button } from "../ui/primitives";
import type { ExtractedAudio, MediaProbe, SourceInfo } from "@/lib/types";

export interface StartRequest {
  file: File;
  source: SourceInfo;
  probe?: MediaProbe;
  trackIndex: number;
  audio?: ExtractedAudio;
  cleanup?: () => Promise<void>;
}

export const ACCEPT =
  ".mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.opus,.flac,.ogg,.aac,video/*,audio/*";

export function DropZone({
  onFiles,
  multiple,
  title = "Arraste um vídeo ou áudio aqui",
  hint = "mp4, mov, mkv, webm, avi, mp3, wav, m4a",
  disabled,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  title?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed px-6 py-10 text-center transition-colors duration-150",
        over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
      )}
    >
      <Upload size={28} strokeWidth={1.25} className="text-fg-3" aria-hidden />
      <div>
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-fg-3">{hint}</p>
      </div>
      <Button variant="primary" disabled={disabled} onClick={() => input.current?.click()}>
        Selecionar arquivo
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={ACCEPT}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

export function LinkField({
  value,
  onChange,
  onSubmit,
  placeholder,
  kind,
  onWrongKind,
  busy,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  kind: LinkKind;
  onWrongKind: (k: LinkKind, v: string) => void;
  busy?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="relative flex-1">
        <Link2 size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v);
            const k = detectKind(v);
            if (k !== "unknown" && k !== kind) onWrongKind(k, v);
          }}
          aria-label="Link"
          placeholder={placeholder}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-[14px] text-fg placeholder:text-fg-3 disabled:opacity-50 max-md:h-11"
        />
      </div>
      <Button type="submit" variant="primary" disabled={disabled || busy || !value.trim()}>
        {busy ? "Carregando…" : "Carregar"}
      </Button>
      {children}
    </form>
  );
}

export function MetaRow({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-3">{k}</dt>
          <dd className="tnum min-w-0 truncate text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
