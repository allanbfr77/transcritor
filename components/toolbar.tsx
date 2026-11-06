"use client";

import { ExternalLink, MoreHorizontal, Moon, PanelLeft, PanelRight, Paperclip, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import type { AppConfig, Transcript } from "@/lib/types";
import { Button, IconButton, Segmented } from "./ui/primitives";
import { Menu, type MenuItem } from "./ui/menu";
import { engineOptions, type Settings } from "./input/options-card";

export function Toolbar({
  transcript,
  settings,
  onSettings,
  config,
  sidebarOpen,
  onToggleSidebar,
  assistantOpen,
  onToggleAssistant,
  onNew,
  onToggleTheme,
  dark,
  onRename,
  onReattach,
  onDelete,
  busy,
}: {
  transcript: Transcript | null;
  settings: Settings;
  onSettings: (s: Settings) => void;
  config: AppConfig | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onNew: () => void;
  onToggleTheme: () => void;
  dark: boolean;
  onRename: () => void;
  onReattach: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const link = transcript && (transcript.source.kind === "youtube" || transcript.source.kind === "drive") ? transcript.source.url : null;
  const items: MenuItem[] = transcript
    ? [
        { label: "Renomear", icon: <Pencil size={14} strokeWidth={1.75} />, onSelect: onRename },
        ...(transcript.source.kind !== "youtube" ? [{ label: "Reanexar mídia", icon: <Paperclip size={14} strokeWidth={1.75} />, onSelect: onReattach }] : []),
        ...(link ? [{ label: "Abrir link original", icon: <ExternalLink size={14} strokeWidth={1.75} />, onSelect: () => window.open(link, "_blank", "noopener,noreferrer") }] : []),
        { label: "Excluir", icon: <Trash2 size={14} strokeWidth={1.75} />, danger: true, separatorBefore: true, onSelect: onDelete },
      ]
    : [];
  return (
    <header className="chrome pt-safe z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line px-2 lg:px-3">
      <IconButton label={sidebarOpen ? "Ocultar histórico" : "Mostrar histórico"} onClick={onToggleSidebar} active={sidebarOpen} className="max-lg:hidden">
        <PanelLeft size={17} strokeWidth={1.75} />
      </IconButton>
      <span className="px-1 text-[14px] font-semibold tracking-tight">Transcritor</span>
      <div className="mx-1 hidden h-4 w-px bg-line lg:block" />
      <p className="min-w-0 flex-1 truncate text-[13px] text-fg-2" title={transcript?.title}>
        {transcript?.title ?? ""}
      </p>
      <Segmented
        label="Motor de transcrição"
        value={settings.engine}
        onChange={(engine) => onSettings({ ...settings, engine })}
        options={engineOptions(config).map((o) => ({ ...o, label: o.value === "local" ? "Local" : "Groq" }))}
        className="max-lg:hidden"
      />
      <Button size="sm" onClick={onNew} disabled={busy} className="max-lg:hidden">
        <Plus size={14} strokeWidth={1.75} />
        Nova
      </Button>
      <IconButton label={dark ? "Tema claro" : "Tema escuro"} onClick={onToggleTheme}>
        {dark ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
      </IconButton>
      <IconButton label={assistantOpen ? "Ocultar assistente" : "Mostrar assistente"} onClick={onToggleAssistant} active={assistantOpen} className="max-lg:hidden">
        <PanelRight size={17} strokeWidth={1.75} />
      </IconButton>
      {transcript && (
        <Menu
          trigger={
            <IconButton label="Mais opções">
              <MoreHorizontal size={17} strokeWidth={1.75} />
            </IconButton>
          }
          items={items}
        />
      )}
    </header>
  );
}
