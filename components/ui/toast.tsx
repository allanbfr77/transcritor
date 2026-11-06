"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, Info } from "lucide-react";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "info";
}

const Ctx = createContext<(text: string, tone?: "ok" | "info") => void>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "info" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 2600);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+72px)] md:pb-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="anim-pop pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] text-fg shadow-pop"
          >
            {t.tone === "ok" ? <Check size={14} strokeWidth={2} className="text-success" /> : <Info size={14} strokeWidth={2} className="text-accent" />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
