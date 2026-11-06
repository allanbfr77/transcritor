"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, History, MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { isAudioFile } from "@/lib/audio/extract";
import { cleanupStaleTemp } from "@/lib/audio/opfs";
import { deleteTranscript, listTranscripts, saveTranscript } from "@/lib/db";
import { uid } from "@/lib/format";
import { runTranscription } from "@/lib/transcribe";
import { looksPortuguese, translateSegments } from "@/lib/ai/translate";
import { LOCAL_MODELS, detectWebGpu } from "@/lib/whisper";
import type { CaptionsResult } from "@/lib/youtube-client";
import { releaseWakeLock, acquireWakeLock } from "@/lib/wakelock";
import { isAbort, type AppConfig, type JobProgress, type Segment, type Transcript } from "@/lib/types";
import { Assistant } from "./assistant";
import { InputPanel } from "./input/input-panel";
import type { Settings } from "./input/options-card";
import type { StartRequest } from "./input/shared";
import type { MediaHandle, PlayerApi } from "./player";
import { ProgressPanel } from "./progress-panel";
import { Sidebar } from "./sidebar";
import { Toolbar } from "./toolbar";
import { TranscriptView } from "./transcript-view";
import { Button, Dialog, TooltipProvider } from "./ui/primitives";
import { ToastProvider, useToast } from "./ui/toast";

type View = "input" | "job" | "result";
type MobileTab = "transcript" | "assistant" | "history";

const DEFAULTS: Settings = { engine: "local", model: "balanced", language: "auto", translate: true };

function ls<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(`transcritor.${key}`);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
function lsSet(key: string, v: unknown) {
  try {
    localStorage.setItem(`transcritor.${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function App() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </TooltipProvider>
  );
}

function Shell() {
  const toast = useToast();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [webgpu, setWebgpu] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [history, setHistory] = useState<Transcript[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [view, setView] = useState<View>("input");
  const [job, setJob] = useState<JobProgress>({ stage: "reading", label: "Lendo arquivo", percent: null });
  const [jobMeta, setJobMeta] = useState<{ title: string; engine: Settings["engine"]; device?: string }>({ title: "", engine: "local" });
  const [current, setCurrent] = useState<Transcript | null>(null);
  const [media, setMedia] = useState<MediaHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantWidth, setAssistantWidth] = useState(380);
  const [mobileTab, setMobileTab] = useState<MobileTab>("transcript");
  const [dark, setDark] = useState(false);
  const [renaming, setRenaming] = useState<Transcript | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Transcript | null>(null);

  const playerRef = useRef<PlayerApi | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const mediaUrlRef = useRef<string | null>(null);
  const reattachRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = view === "job";

  // Inicialização
  useEffect(() => {
    setSettings({ ...DEFAULTS, ...ls<Partial<Settings>>("settings", {}) });
    setSidebarOpen(ls("sidebar", true));
    setAssistantOpen(ls("assistant", true));
    setAssistantWidth(ls("assistantWidth", 380));
    const t = ls<string>("theme", "system");
    const root = document.documentElement;
    setDark(t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches));
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ groq: false, gemini: false, aiProvider: "groq", aiConfigured: false, ytdlp: false }));
    void detectWebGpu().then(setWebgpu);
    void listTranscripts().then((l) => {
      setHistory(l);
      setHistoryLoading(false);
    });
    void cleanupStaleTemp();
  }, []);

  // Ajustes de configuração inválida
  useEffect(() => {
    setSettings((s) => {
      let n = s;
      if (n.engine === "groq" && config && !config.groq) n = { ...n, engine: "local" };
      if (n.model === "max" && !webgpu) n = { ...n, model: "balanced" };
      return n;
    });
  }, [config, webgpu]);

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (abortRef.current && view === "job") e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [view]);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    lsSet("settings", s);
  };

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.setAttribute("data-theme", next);
    lsSet("theme", next);
  };

  const releaseMedia = useCallback(() => {
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    mediaUrlRef.current = null;
    const c = cleanupRef.current;
    cleanupRef.current = undefined;
    void c?.();
  }, []);

  const attachFile = useCallback((file: File) => {
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    const url = URL.createObjectURL(file);
    mediaUrlRef.current = url;
    setMedia({ kind: "element", url, isVideo: !isAudioFile(file), name: file.name });
  }, []);

  const openTranscript = (t: Transcript) => {
    if (busy) return;
    releaseMedia();
    setCurrent(t);
    setMedia(t.source.kind === "youtube" ? { kind: "youtube", videoId: t.source.videoId } : null);
    setView("result");
    setError(null);
    setMobileTab("transcript");
  };

  const goNew = () => {
    if (busy) return;
    releaseMedia();
    setCurrent(null);
    setMedia(null);
    setView("input");
    setError(null);
    setMobileTab("transcript");
  };

  const persist = async (t: Transcript) => {
    await saveTranscript(t);
    setHistory((h) => [t, ...h.filter((x) => x.id !== t.id)]);
  };

  /** Traduz para pt-BR quando a opção está ativa e o texto não está em português. */
  const maybeTranslate = async (segs: Segment[], lang: string, ac: AbortController): Promise<Segment[]> => {
    if (!settings.translate || !config?.aiConfigured) return segs;
    if (lang.toLowerCase().startsWith("pt") || looksPortuguese(segs)) return segs;
    setJob({ stage: "finalizing", label: "Traduzindo para português (0%)", percent: 0 });
    try {
      return await translateSegments(
        segs,
        ac.signal,
        (d, t) => setJob({ stage: "finalizing", label: `Traduzindo para português (${Math.round((d / t) * 100)}%)`, percent: (d / t) * 100 }),
        (n) => setJob((j) => ({ ...j, detail: n ?? undefined })),
      );
    } catch (e) {
      if (isAbort(e)) throw e;
      toast(`Não foi possível traduzir; mantive o idioma original. ${e instanceof Error ? e.message : ""}`, "info");
      return segs;
    }
  };

  const startJob = async (req: StartRequest) => {
    releaseMedia();
    const ac = new AbortController();
    abortRef.current = ac;
    cleanupRef.current = req.cleanup;
    const title = req.source.kind === "youtube" ? req.source.title : req.source.name;
    setError(null);
    setCurrent(null);
    setMedia(null);
    setView("job");
    setMobileTab("transcript");
    setJob({ stage: "reading", label: "Lendo arquivo", percent: null });
    setJobMeta({ title, engine: settings.engine });
    await acquireWakeLock();
    try {
      const r = await runTranscription({
        file: req.file,
        engine: settings.engine,
        model: settings.model,
        language: settings.language,
        trackIndex: req.trackIndex,
        probe: req.probe,
        audio: req.audio,
        onProgress: (p) => setJob(p),
        onNotice: (m) => toast(m, "info"),
        signal: ac.signal,
      });
      const finalSegs = await maybeTranslate(r.segments, settings.language === "auto" ? "" : settings.language, ac);
      const t: Transcript = {
        id: uid(),
        title,
        createdAt: Date.now(),
        duration: r.duration,
        engine: settings.engine,
        model: settings.engine === "local" ? LOCAL_MODELS.find((m) => m.id === settings.model)?.label : "whisper-large-v3-turbo",
        language: settings.language,
        source: req.source,
        segments: finalSegs,
      };
      await persist(t);
      setCurrent(t);
      if (req.source.kind === "youtube") setMedia({ kind: "youtube", videoId: req.source.videoId });
      else attachFile(req.file);
      setView("result");
    } catch (e) {
      cleanupRef.current = undefined;
      void req.cleanup?.();
      if (isAbort(e)) toast("Transcrição cancelada", "info");
      else setError(e instanceof Error ? e.message : "Ocorreu um erro inesperado.");
      setView("input");
    } finally {
      abortRef.current = null;
      await releaseWakeLock();
    }
  };

  const onCaptions = async (r: CaptionsResult, url: string) => {
    releaseMedia();
    const ac = new AbortController();
    abortRef.current = ac;
    let segs = r.segments;
    if (settings.translate && config?.aiConfigured && !r.selected.lang.toLowerCase().startsWith("pt") && !looksPortuguese(segs)) {
      setView("job");
      setJobMeta({ title: r.title, engine: "local" });
      try {
        segs = await maybeTranslate(segs, r.selected.lang, ac);
      } catch {
        abortRef.current = null;
        setView("input");
        toast("Tradução cancelada", "info");
        return;
      }
    }
    abortRef.current = null;
    const t: Transcript = {
      id: uid(),
      title: r.title,
      createdAt: Date.now(),
      duration: r.duration,
      engine: "youtube",
      language: r.selected.lang,
      source: { kind: "youtube", title: r.title, channel: r.channel, url, videoId: r.videoId, auto: r.selected.auto, lang: r.selected.lang },
      segments: segs,
    };
    await persist(t);
    setCurrent(t);
    setMedia({ kind: "youtube", videoId: r.videoId });
    setView("result");
    setError(null);
  };

  const updateSegments = (segs: Segment[]) => {
    setCurrent((c) => {
      if (!c) return c;
      const t = { ...c, segments: segs };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(t), 600);
      return t;
    });
  };

  const rename = async (t: Transcript, title: string) => {
    const n = { ...t, title };
    await persist(n);
    setCurrent((c) => (c && c.id === t.id ? n : c));
  };

  const remove = async (t: Transcript) => {
    await deleteTranscript(t.id);
    setHistory((h) => h.filter((x) => x.id !== t.id));
    if (current?.id === t.id) goNew();
    toast("Transcrição excluída");
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = assistantWidth;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.min(640, Math.max(300, startW + (startX - ev.clientX)));
      setAssistantWidth(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      lsSet("assistantWidth", w);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const seekFromAssistant = (t: number) => {
    setMobileTab("transcript");
    setTimeout(() => playerRef.current?.seek(t, true), 50);
  };

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <Toolbar
        transcript={current}
        settings={settings}
        onSettings={updateSettings}
        config={config}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => {
          setSidebarOpen((v) => !v);
          lsSet("sidebar", !sidebarOpen);
        }}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => {
          setAssistantOpen((v) => !v);
          lsSet("assistant", !assistantOpen);
        }}
        onNew={goNew}
        onToggleTheme={toggleTheme}
        dark={dark}
        onRename={() => current && (setRenameValue(current.title), setRenaming(current))}
        onReattach={() => reattachRef.current?.click()}
        onDelete={() => current && setDeleting(current)}
        busy={busy}
      />

      <div className="flex min-h-0 flex-1">
        {/* Histórico */}
        <aside
          aria-label="Histórico"
          className={cn(
            "min-h-0 shrink-0 flex-col border-line bg-surface lg:w-64 lg:border-r",
            sidebarOpen ? "lg:flex" : "lg:hidden",
            mobileTab === "history" ? "max-lg:flex max-lg:flex-1" : "max-lg:hidden",
          )}
        >
          <Sidebar
            items={history}
            loading={historyLoading}
            currentId={current?.id ?? null}
            onOpen={openTranscript}
            onNew={goNew}
            onRename={(t) => (setRenameValue(t.title), setRenaming(t))}
            onDelete={setDeleting}
          />
        </aside>

        {/* Área central */}
        <main className={cn("min-w-0 flex-1 flex-col overflow-hidden lg:flex", mobileTab === "transcript" ? "flex" : "max-lg:hidden")}>
          {view === "input" && (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <InputPanel config={config} settings={settings} onSettings={updateSettings} webgpu={webgpu} error={error} onStart={startJob} onCaptions={onCaptions} />
            </div>
          )}
          {view === "job" && (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <ProgressPanel job={job} title={jobMeta.title} engine={jobMeta.engine} device={jobMeta.device} onCancel={() => abortRef.current?.abort()} />
            </div>
          )}
          {view === "result" && current && (
            <TranscriptView
              key={current.id}
              transcript={current}
              media={media}
              playerRef={playerRef}
              onSegments={updateSegments}
              onReattach={() => reattachRef.current?.click()}
            />
          )}
        </main>

        {/* Assistente */}
        {current && view === "result" ? (
          <aside
            aria-label="Assistente"
            style={{ ["--aw" as string]: `${assistantWidth}px` }}
            className={cn(
              "relative min-h-0 shrink-0 flex-col border-line bg-surface lg:w-[var(--aw)] lg:border-l",
              assistantOpen ? "lg:flex" : "lg:hidden",
              mobileTab === "assistant" ? "max-lg:flex max-lg:flex-1" : "max-lg:hidden",
            )}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar assistente"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const w = Math.min(640, Math.max(300, assistantWidth + (e.key === "ArrowLeft" ? 24 : -24)));
                  setAssistantWidth(w);
                  lsSet("assistantWidth", w);
                }
              }}
              className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/30 lg:block"
            />
            <Assistant transcript={current} config={config} onSeek={seekFromAssistant} />
          </aside>
        ) : (
          mobileTab === "assistant" && (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-fg-3 lg:hidden">
              Abra ou crie uma transcrição para usar o assistente.
            </div>
          )
        )}
      </div>

      {/* Tab bar (celular) */}
      <nav aria-label="Seções" className="chrome pb-safe z-30 grid shrink-0 grid-cols-3 border-t border-line lg:hidden">
        {(
          [
            ["transcript", "Transcrição", FileText],
            ["assistant", "Assistente", MessageSquare],
            ["history", "Histórico", History],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobileTab(id)}
            aria-current={mobileTab === id ? "page" : undefined}
            className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", mobileTab === id ? "text-accent" : "text-fg-3")}
          >
            <Icon size={20} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </nav>

      <input
        ref={reattachRef}
        type="file"
        hidden
        accept="video/*,audio/*,.mkv,.avi,.opus,.flac"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) {
            attachFile(f);
            toast("Mídia anexada");
          }
        }}
      />

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title="Renomear transcrição">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (renaming && renameValue.trim()) void rename(renaming, renameValue.trim());
            setRenaming(null);
          }}
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label="Novo nome"
            className="h-9 w-full rounded-control border border-line-strong bg-bg px-3 text-[14px] max-lg:h-11"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!renameValue.trim()}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir transcrição?"
        description={deleting ? `“${deleting.title}” será removida deste navegador. Essa ação não pode ser desfeita.` : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="!bg-danger hover:!brightness-95"
            onClick={() => {
              if (deleting) void remove(deleting);
              setDeleting(null);
            }}
          >
            Excluir
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
