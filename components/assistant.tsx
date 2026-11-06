"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpenText, Check, Copy, Languages, List, ListChecks, Quote, SendHorizontal, SpellCheck, Square, ExternalLink } from "lucide-react";
import { Menu } from "./ui/menu";
import { Banner, Button, IconButton } from "./ui/primitives";
import { useToast } from "./ui/toast";
import { buildChatContext, chatSystem, clockToSec, runTask, streamAI, TASK_LABELS, TIMESTAMP_RE, type TaskId } from "@/lib/ai/client";
import { isAbort, type AppConfig, type Transcript } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  label?: string;
  error?: boolean;
}

const TRANSLATE_TO = ["inglês", "espanhol", "francês", "alemão", "italiano", "japonês", "português do Brasil"];

function renderInline(text: string, onSeek: (t: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((p, i) => {
    const bold = p.startsWith("**") && p.endsWith("**") && p.length > 4;
    const raw = bold ? p.slice(2, -2) : p;
    const nodes: ReactNode[] = [];
    let last = 0;
    for (const m of raw.matchAll(TIMESTAMP_RE)) {
      const idx = m.index ?? 0;
      nodes.push(raw.slice(last, idx));
      nodes.push(
        <button
          key={`${i}-${idx}`}
          type="button"
          onClick={() => onSeek(clockToSec(m[1]))}
          className="tnum rounded px-0.5 font-medium text-accent hover:underline"
          aria-label={`Ir para ${m[1]}`}
        >
          [{m[1]}]
        </button>,
      );
      last = idx + m[0].length;
    }
    nodes.push(raw.slice(last));
    out.push(bold ? <strong key={i}>{nodes}</strong> : <Fragment key={i}>{nodes}</Fragment>);
  });
  return out;
}

function Markdown({ text, onSeek }: { text: string; onSeek: (t: number) => void }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-[13.5px] leading-[1.65]">
      {lines.map((l, i) => {
        if (!l.trim()) return <div key={i} className="h-1" />;
        const h = l.match(/^#{1,4}\s+(.*)$/);
        if (h) return <p key={i} className="pt-1 font-semibold">{renderInline(h[1], onSeek)}</p>;
        const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (li) {
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span className="text-fg-3">•</span>
              <span className="min-w-0">{renderInline(li[1], onSeek)}</span>
            </p>
          );
        }
        return <p key={i}>{renderInline(l, onSeek)}</p>;
      })}
    </div>
  );
}

export function Assistant({ transcript, config, onSeek }: { transcript: Transcript; config: AppConfig | null; onSeek: (t: number) => void }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const ctxRef = useRef<{ key: string; text: string; condensed: boolean } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  // Reinicia ao trocar de transcrição
  useEffect(() => {
    abortRef.current?.abort();
    setMsgs([]);
    setNotice(null);
    setBusy(false);
    ctxRef.current = null;
  }, [transcript.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, notice]);

  const configured = config?.aiConfigured ?? false;

  const push = (m: Omit<Msg, "id">) => {
    const id = ++idRef.current;
    setMsgs((l) => [...l, { ...m, id }]);
    return id;
  };
  const patch = (id: number, p: Partial<Msg>) => setMsgs((l) => l.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const fail = (id: number, e: unknown) => {
    if (isAbort(e)) {
      patch(id, { content: "Cancelado." });
      return;
    }
    patch(id, { content: e instanceof Error ? e.message : "Algo deu errado.", error: true });
  };

  const run = async (task: TaskId, extra?: string) => {
    if (busy) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    const label = task === "translate" ? `Tradução (${extra})` : TASK_LABELS[task];
    push({ role: "user", content: label });
    const id = push({ role: "assistant", content: "", label });
    try {
      const out = await runTask(task, transcript.segments, { signal: ac.signal, onText: (t) => patch(id, { content: t }), onNotice: setNotice }, extra);
      patch(id, { content: out });
    } catch (e) {
      fail(id, e);
    } finally {
      setNotice(null);
      setBusy(false);
    }
  };

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    const history = [...msgs.filter((m) => !m.error && m.content), { id: 0, role: "user" as const, content: q }];
    push({ role: "user", content: q });
    const id = push({ role: "assistant", content: "" });
    try {
      const key = `${transcript.id}:${transcript.segments.length}`;
      if (!ctxRef.current || ctxRef.current.key !== key) {
        const text = await buildChatContext(transcript.segments, ac.signal, setNotice);
        // "condensado" apenas quando a transcrição passou do limite e houve map-reduce
        const fullLen = transcript.segments.reduce((n, s) => n + s.text.length + 13, 0);
        ctxRef.current = { key, text, condensed: fullLen > 24_000 };
      }
      const sys = chatSystem(ctxRef.current.text, ctxRef.current.condensed);
      const out = await streamAI(
        sys,
        history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        ac.signal,
        (t) => patch(id, { content: t }),
        (s) => setNotice(`Limite do plano gratuito atingido. Tentando de novo em ${s} s…`),
      );
      patch(id, { content: out });
    } catch (e) {
      fail(id, e);
    } finally {
      setNotice(null);
      setBusy(false);
    }
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopied(m.id);
      toast("Copiado");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast("Não foi possível copiar", "info");
    }
  };

  if (!configured) {
    return (
      <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-4">
        <h2 className="text-[14px] font-semibold">Assistente</h2>
        <p className="text-[13px] leading-5 text-fg-2">
          O assistente precisa de uma chave de API gratuita (sem cartão). A transcrição continua funcionando normalmente sem ela.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-5 text-fg-2">
          <li>
            Crie uma chave em{" "}
            <a className="inline-flex items-center gap-0.5 text-accent hover:underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
              console.groq.com <ExternalLink size={11} strokeWidth={1.75} />
            </a>{" "}
            ou em{" "}
            <a className="inline-flex items-center gap-0.5 text-accent hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com <ExternalLink size={11} strokeWidth={1.75} />
            </a>
            .
          </li>
          <li>
            Salve no arquivo <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">.env.local</code> como <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">GROQ_API_KEY</code> (ou{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">GEMINI_API_KEY</code> com <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">AI_PROVIDER=gemini</code>).
          </li>
          <li>Reinicie o servidor.</li>
        </ol>
      </div>
    );
  }

  const quick: { id: TaskId; label: string; icon: ReactNode }[] = [
    { id: "summary", label: "Resumir", icon: <BookOpenText size={14} strokeWidth={1.75} /> },
    { id: "points", label: "Pontos principais", icon: <ListChecks size={14} strokeWidth={1.75} /> },
    { id: "chapters", label: "Capítulos", icon: <List size={14} strokeWidth={1.75} /> },
    { id: "fix", label: "Corrigir texto", icon: <SpellCheck size={14} strokeWidth={1.75} /> },
    { id: "quotes", label: "Citações", icon: <Quote size={14} strokeWidth={1.75} /> },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-3">
        <h2 className="mb-2 text-[14px] font-semibold">Assistente</h2>
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <Button key={q.id} size="sm" disabled={busy} onClick={() => run(q.id)}>
              {q.icon}
              {q.label}
            </Button>
          ))}
          <Menu
            align="start"
            trigger={
              <Button size="sm" disabled={busy}>
                <Languages size={14} strokeWidth={1.75} />
                Traduzir para…
              </Button>
            }
            items={TRANSLATE_TO.map((l) => ({ label: l, onSelect: () => run("translate", l) }))}
          />
        </div>
      </div>

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {msgs.length === 0 && (
          <p className="text-[13px] leading-5 text-fg-3">
            Use os botões acima ou pergunte algo sobre o vídeo. Os tempos nas respostas levam o player ao ponto exato.
          </p>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-8 rounded-card bg-accent-soft px-3 py-2 text-[13.5px] text-fg">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className={cn("group rounded-card border border-line bg-surface p-3", m.error && "border-danger/40")}>
              {m.label && <p className="mb-1.5 text-[12px] font-medium text-fg-3">{m.label}</p>}
              {m.content ? (
                m.error ? (
                  <p className="text-[13px] text-danger">{m.content}</p>
                ) : (
                  <Markdown text={m.content} onSeek={onSeek} />
                )
              ) : (
                <div className="space-y-2" aria-label="Gerando resposta">
                  <div className="skeleton h-3 w-11/12" />
                  <div className="skeleton h-3 w-8/12" />
                </div>
              )}
              {m.content && !m.error && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => copy(m)}>
                    {copied === m.id ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
                    Copiar
                  </Button>
                </div>
              )}
            </div>
          ),
        )}
        {notice && <Banner>{notice}</Banner>}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3 pb-safe"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
            e.stopPropagation();
          }}
          rows={1}
          aria-label="Pergunte algo sobre o vídeo"
          placeholder="Pergunte algo sobre o vídeo"
          className="max-h-32 min-h-9 flex-1 resize-none rounded-control border border-line-strong bg-bg px-3 py-2 text-[13.5px] text-fg placeholder:text-fg-3 max-md:min-h-11"
        />
        {busy ? (
          <IconButton label="Parar" type="button" onClick={() => abortRef.current?.abort()} className="border border-line-strong">
            <Square size={14} strokeWidth={1.75} />
          </IconButton>
        ) : (
          <Button type="submit" variant="primary" disabled={!input.trim()} aria-label="Enviar" className="!px-2.5">
            <SendHorizontal size={16} strokeWidth={1.75} />
          </Button>
        )}
      </form>
    </div>
  );
}
