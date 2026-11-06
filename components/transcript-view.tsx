"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  Keyboard,
  Pencil,
  Search,
  X,
} from "lucide-react";
import type { Segment, Transcript } from "@/lib/types";
import { download, formatClock, groupParagraphs, safeName, toJson, toSrt, toTxt, toVtt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Player, type MediaHandle, type PlayerApi } from "./player";
import { Banner, Button, IconButton, Kbd, Popover, SwitchRow } from "./ui/primitives";
import { Menu } from "./ui/menu";
import { useToast } from "./ui/toast";

interface Props {
  transcript: Transcript;
  media: MediaHandle;
  playerRef: RefObject<PlayerApi | null>;
  onSegments: (segs: Segment[]) => void;
  onReattach: () => void;
}

interface Match {
  seg: number;
  from: number;
  to: number;
}

function findActive(segs: Segment[], t: number): number {
  let lo = 0;
  let hi = segs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t + 0.05) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (ans >= 0 && t > segs[ans].end + 1.5) return -1;
  return ans;
}

function load<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(`transcritor.${key}`);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(`transcritor.${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function TranscriptView({ transcript, media, playerRef, onSegments, onReattach }: Props) {
  const toast = useToast();
  const segs = transcript.segments;
  const [time, setTime] = useState(0);
  const [showTs, setShowTs] = useState(true);
  const [paragraphs, setParagraphs] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShowTs(load("ts", true));
    setParagraphs(load("paragraphs", false));
    setAutoScroll(load("autoscroll", true));
  }, []);

  const active = useMemo(() => findActive(segs, time), [segs, time]);
  const activeId = active >= 0 ? segs[active].id : null;

  // Busca
  const matches = useMemo<Match[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Match[] = [];
    segs.forEach((s, i) => {
      const lower = s.text.toLowerCase();
      let p = 0;
      for (;;) {
        const f = lower.indexOf(q, p);
        if (f < 0) break;
        out.push({ seg: i, from: f, to: f + q.length });
        p = f + q.length;
      }
    });
    return out;
  }, [segs, query]);
  const cur = matches.length ? Math.min(matchIdx, matches.length - 1) : -1;

  const scrollToSeg = useCallback((id: string, block: ScrollLogicalPosition = "nearest") => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-seg="${CSS.escape(id)}"]`);
    node?.scrollIntoView({ block, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (cur >= 0) scrollToSeg(segs[matches[cur].seg].id, "center");
  }, [cur, matches, segs, scrollToSeg]);

  // Acompanha a reprodução
  useEffect(() => {
    if (autoScroll && activeId && !query) scrollToSeg(activeId);
  }, [activeId, autoScroll, query, scrollToSeg]);

  // Atalhos locais
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const interactive = !!t && (t.tagName === "BUTTON" || t.tagName === "A" || t.getAttribute("role") === "radio" || t.getAttribute("role") === "switch");
      if (e.key === " " && !interactive) {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        playerRef.current?.skip(-5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        playerRef.current?.skip(5);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [playerRef]);

  const seek = (t: number) => playerRef.current?.seek(t, true);

  const copy = async (text: string, msg = "Copiado") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast("Não foi possível copiar", "info");
    }
  };

  const updateSeg = (id: string, text: string) => {
    onSegments(segs.map((s) => (s.id === id ? { ...s, text, words: undefined } : s)));
  };

  const base = safeName(transcript.title);
  const t2 = { ...transcript };

  const stepMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    setMatchIdx((i) => (i + dir + matches.length) % matches.length);
  };

  const highlight = (s: Segment, i: number) => {
    if (!query.trim()) return s.text;
    const mine = matches.map((m, k) => ({ ...m, k })).filter((m) => m.seg === i);
    if (!mine.length) return s.text;
    const parts: React.ReactNode[] = [];
    let p = 0;
    mine.forEach((m) => {
      parts.push(s.text.slice(p, m.from));
      parts.push(
        <mark
          key={m.k}
          className={cn("rounded-[3px] px-0.5 text-fg", m.k === cur ? "bg-accent text-on-accent" : "bg-warning-soft ring-1 ring-warning/40")}
        >
          {s.text.slice(m.from, m.to)}
        </mark>,
      );
      p = m.to;
    });
    parts.push(s.text.slice(p));
    return parts;
  };

  const paras = useMemo(() => (paragraphs ? groupParagraphs(segs) : []), [paragraphs, segs]);

  const textClass = "text-[15px] leading-[1.75] text-fg";

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 @3xl:grid @3xl:grid-cols-[minmax(300px,42%)_minmax(0,1fr)] @3xl:gap-4 @3xl:p-4">
        <div className="sticky top-0 z-10 -mx-3 -mt-3 bg-bg px-3 pt-3 @3xl:static @3xl:m-0 @3xl:bg-transparent @3xl:p-0">
          <div className="@3xl:sticky @3xl:top-4 space-y-3">
            <Player ref={playerRef} media={media} onTime={setTime} onReattach={onReattach} className="max-h-[38dvh] @3xl:max-h-none" />
            {transcript.source.kind === "youtube" && (
              <Banner>
                Origem: Legendas do YouTube{transcript.source.auto ? " (automáticas)" : ""}. A precisão depende da legenda original.
              </Banner>
            )}
          </div>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface" aria-label="Transcrição">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
            <div className="relative min-w-40 flex-1">
              <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMatchIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    stepMatch(e.shiftKey ? -1 : 1);
                  } else if (e.key === "Escape") {
                    setQuery("");
                    e.currentTarget.blur();
                  }
                }}
                aria-label="Buscar na transcrição"
                placeholder="Buscar na transcrição"
                className="h-8 w-full rounded-control border border-line-strong bg-bg pl-8 pr-24 text-[13px] text-fg placeholder:text-fg-3 max-md:h-11"
              />
              {query && (
                <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                  <span className="tnum px-1 text-[12px] text-fg-3">{matches.length ? `${cur + 1}/${matches.length}` : "0"}</span>
                  <IconButton label="Anterior (Shift+Enter)" className="size-6 max-md:size-9" onClick={() => stepMatch(-1)} disabled={!matches.length}>
                    <ChevronUp size={14} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label="Próximo (Enter)" className="size-6 max-md:size-9" onClick={() => stepMatch(1)} disabled={!matches.length}>
                    <ChevronDown size={14} strokeWidth={1.75} />
                  </IconButton>
                  <IconButton label="Limpar busca" className="size-6 max-md:size-9" onClick={() => setQuery("")}>
                    <X size={14} strokeWidth={1.75} />
                  </IconButton>
                </div>
              )}
            </div>

            <Popover
              trigger={
                <IconButton label="Exibição">
                  <Eye size={16} strokeWidth={1.75} />
                </IconButton>
              }
            >
              <div className="space-y-0.5">
                <SwitchRow
                  label="Mostrar timestamps"
                  checked={showTs}
                  onChange={(v) => {
                    setShowTs(v);
                    save("ts", v);
                  }}
                />
                <SwitchRow
                  label="Separar por parágrafos"
                  checked={paragraphs}
                  onChange={(v) => {
                    setParagraphs(v);
                    save("paragraphs", v);
                  }}
                />
                <SwitchRow
                  label="Rolar acompanhando o vídeo"
                  checked={autoScroll}
                  onChange={(v) => {
                    setAutoScroll(v);
                    save("autoscroll", v);
                  }}
                />
              </div>
            </Popover>

            <Menu
              trigger={
                <Button size="sm">
                  <Copy size={14} strokeWidth={1.75} />
                  Copiar
                </Button>
              }
              items={[
                { label: "Copiar tudo", onSelect: () => copy(toTxt(segs, showTs), "Transcrição copiada") },
                { label: "Copiar sem timestamps", onSelect: () => copy(toTxt(segs, false), "Transcrição copiada") },
              ]}
            />
            <Menu
              trigger={
                <Button size="sm">
                  <Download size={14} strokeWidth={1.75} />
                  Baixar
                </Button>
              }
              items={[
                { label: "Texto (.txt)", onSelect: () => download(`${base}.txt`, toTxt(segs, showTs), "text/plain;charset=utf-8") },
                { label: "Legenda SRT (.srt)", onSelect: () => download(`${base}.srt`, toSrt(segs), "application/x-subrip;charset=utf-8") },
                { label: "WebVTT (.vtt)", onSelect: () => download(`${base}.vtt`, toVtt(segs), "text/vtt;charset=utf-8") },
                { label: "JSON (.json)", onSelect: () => download(`${base}.json`, toJson(t2), "application/json") },
              ]}
            />
            <Popover
              trigger={
                <IconButton label="Atalhos de teclado">
                  <Keyboard size={16} strokeWidth={1.75} />
                </IconButton>
              }
            >
              <ul className="space-y-2 text-[13px]">
                {[
                  ["Espaço", "Reproduzir / pausar"],
                  ["← →", "Voltar / avançar 5 s"],
                  ["Ctrl/⌘ + F", "Buscar"],
                  ["Enter / Shift+Enter", "Próximo / anterior resultado"],
                  ["Ctrl/⌘ + C", "Copiar seleção"],
                  ["Enter / Esc", "Salvar / cancelar edição"],
                ].map(([k, d]) => (
                  <li key={k} className="flex items-center justify-between gap-3">
                    <span className="text-fg-2">{d}</span>
                    <Kbd>{k}</Kbd>
                  </li>
                ))}
              </ul>
            </Popover>
          </div>

          <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2 max-md:pb-4" role="list">
            <div className="mx-auto max-w-[68ch]">
              {paragraphs ? (
                paras.map((p, pi) => (
                  <div key={pi} className="flex gap-3 rounded-control px-2 py-2.5" role="listitem">
                    {showTs && (
                      <button
                        type="button"
                        onClick={() => seek(p.start)}
                        className="tnum mt-[3px] h-fit shrink-0 rounded px-1 text-[12px] text-fg-3 hover:text-accent"
                        aria-label={`Ir para ${formatClock(p.start)}`}
                      >
                        [{formatClock(p.start)}]
                      </button>
                    )}
                    <p className={textClass}>
                      {p.segments.map((s) => {
                        const i = segs.indexOf(s);
                        return (
                          <span
                            key={s.id}
                            data-seg={s.id}
                            onClick={() => seek(s.start)}
                            className={cn("cursor-pointer rounded-[4px] transition-colors", s.id === activeId && "bg-accent-soft")}
                          >
                            {highlight(s, i)}{" "}
                          </span>
                        );
                      })}
                    </p>
                  </div>
                ))
              ) : (
                segs.map((s, i) => (
                  <div
                    key={s.id}
                    data-seg={s.id}
                    role="listitem"
                    onClick={() => editing !== s.id && seek(s.start)}
                    className={cn(
                      "group relative flex cursor-pointer gap-3 rounded-control px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2",
                      s.id === activeId && "bg-accent-soft hover:bg-accent-soft",
                    )}
                  >
                    {showTs && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          seek(s.start);
                        }}
                        className="tnum mt-[3px] h-fit shrink-0 rounded px-1 text-[12px] text-fg-3 hover:text-accent"
                        aria-label={`Ir para ${formatClock(s.start)}`}
                      >
                        [{formatClock(s.start)}]
                      </button>
                    )}
                    {editing === s.id ? (
                      <EditBox
                        value={s.text}
                        className={textClass}
                        onCommit={(v) => {
                          setEditing(null);
                          if (v.trim() && v !== s.text) updateSeg(s.id, v.trim());
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <p className={cn(textClass, "min-w-0 flex-1")} onDoubleClick={() => setEditing(s.id)}>
                        {highlight(s, i)}
                      </p>
                    )}
                    {editing !== s.id && (
                      <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                        <IconButton
                          label="Copiar trecho"
                          className="size-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            void copy(showTs ? `[${formatClock(s.start)}] ${s.text}` : s.text, "Trecho copiado");
                          }}
                        >
                          <Copy size={14} strokeWidth={1.75} />
                        </IconButton>
                        <IconButton
                          label="Editar trecho"
                          className="size-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(s.id);
                          }}
                        >
                          <Pencil size={14} strokeWidth={1.75} />
                        </IconButton>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function EditBox({ value, className, onCommit, onCancel }: { value: string; className: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(v);
    else onCancel();
  };
  return (
    <textarea
      ref={ref}
      value={v}
      rows={1}
      aria-label="Editar trecho"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value.replace(/\n/g, " "))}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
        e.stopPropagation();
      }}
      className={cn(className, "min-w-0 flex-1 resize-none rounded-[6px] border border-accent bg-bg px-1.5 py-0.5 outline-none")}
    />
  );
}
