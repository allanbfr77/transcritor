"use client";

import { ExternalLink, FileText, HardDrive, MoreHorizontal, Pencil, Plus, Trash2, CirclePlay } from "lucide-react";
import type { Transcript } from "@/lib/types";
import { formatClock, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button, IconButton, Skeleton } from "./ui/primitives";
import { Menu } from "./ui/menu";

const ENGINE_LABEL: Record<string, string> = { local: "Local", groq: "Groq", youtube: "YouTube" };

export function Sidebar({
  items,
  loading,
  currentId,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: {
  items: Transcript[];
  loading: boolean;
  currentId: string | null;
  onOpen: (t: Transcript) => void;
  onNew: () => void;
  onRename: (t: Transcript) => void;
  onDelete: (t: Transcript) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between p-3">
        <h2 className="text-[14px] font-semibold">Histórico</h2>
        <Button size="sm" onClick={onNew}>
          <Plus size={14} strokeWidth={1.75} />
          Nova
        </Button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {loading && (
          <div className="space-y-2 p-1">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}
        {!loading && items.length === 0 && <p className="px-2 py-4 text-[13px] leading-5 text-fg-3">Suas transcrições aparecem aqui. Ficam salvas só neste navegador.</p>}
        {items.map((t) => {
          const link = t.source.kind === "youtube" || t.source.kind === "drive" ? t.source.url : null;
          const Icon = t.source.kind === "youtube" ? CirclePlay : t.source.kind === "drive" ? HardDrive : FileText;
          return (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-1 rounded-control pr-1 transition-colors hover:bg-surface-2",
                currentId === t.id && "bg-accent-soft hover:bg-accent-soft",
              )}
            >
              <button type="button" onClick={() => onOpen(t)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-control px-2 py-2 text-left max-md:min-h-14">
                <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{t.title}</span>
                  <span className="tnum block truncate text-[12px] text-fg-3">
                    {formatDate(t.createdAt)} · {formatClock(t.duration)} · {ENGINE_LABEL[t.engine]}
                  </span>
                </span>
              </button>
              <Menu
                trigger={
                  <IconButton label="Mais ações" className="opacity-60 group-hover:opacity-100 max-md:opacity-100">
                    <MoreHorizontal size={16} strokeWidth={1.75} />
                  </IconButton>
                }
                items={[
                  { label: "Renomear", icon: <Pencil size={14} strokeWidth={1.75} />, onSelect: () => onRename(t) },
                  ...(link
                    ? [{ label: "Abrir link original", icon: <ExternalLink size={14} strokeWidth={1.75} />, onSelect: () => window.open(link, "_blank", "noopener,noreferrer") }]
                    : []),
                  { label: "Excluir", icon: <Trash2 size={14} strokeWidth={1.75} />, danger: true, separatorBefore: true, onSelect: () => onDelete(t) },
                ]}
              />
            </div>
          );
        })}
      </div>

    </div>
  );
}
