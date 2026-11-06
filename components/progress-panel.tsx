"use client";

import { Check } from "lucide-react";
import { formatEta } from "@/lib/format";
import type { EngineId, JobProgress, JobStage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button, ProgressBar } from "./ui/primitives";

const ORDER: { id: JobStage; label: string }[] = [
  { id: "reading", label: "Lendo arquivo" },
  { id: "extracting", label: "Extraindo áudio" },
  { id: "model", label: "Baixando modelo" },
  { id: "transcribing", label: "Transcrevendo" },
  { id: "finalizing", label: "Finalizando" },
];

export function ProgressPanel({
  job,
  title,
  engine,
  device,
  onCancel,
}: {
  job: JobProgress;
  title: string;
  engine: EngineId;
  device?: string;
  onCancel: () => void;
}) {
  const stages = ORDER.filter((s) => (s.id === "model" ? engine === "local" : true));
  const idx = stages.findIndex((s) => s.id === job.stage);
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 p-4 md:py-16">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Transcrevendo</h1>
        <p className="mt-1 truncate text-[13px] text-fg-2">{title}</p>
      </div>
      <div className="space-y-4 rounded-card border border-line bg-surface p-4">
        <div aria-live="polite">
          <p className="text-[14px] font-medium">{job.label}</p>
          <p className="tnum mt-0.5 min-h-5 text-[13px] text-fg-2">{job.detail ?? formatEta(job.etaSec)}</p>
        </div>
        <ProgressBar percent={job.percent} />
        <ol className="space-y-1.5">
          {stages.map((s, i) => {
            const done = i < idx;
            const cur = i === idx;
            return (
              <li key={s.id} className={cn("flex items-center gap-2 text-[13px]", cur ? "text-fg" : done ? "text-fg-2" : "text-fg-3")}>
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border",
                    done ? "border-accent bg-accent text-on-accent" : cur ? "border-accent" : "border-line-strong",
                  )}
                >
                  {done ? <Check size={10} strokeWidth={3} /> : cur ? <span className="size-1.5 rounded-full bg-accent" /> : null}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>
        {engine === "local" && device && <p className="text-[12px] text-fg-3">Executando em {device}.</p>}
        <p className="text-[12px] leading-5 text-fg-3">
          Mantenha esta aba aberta. O progresso das janelas já transcritas é salvo; se a aba fechar, você pode retomar de onde parou ao enviar o mesmo arquivo.
        </p>
      </div>
      <div className="flex justify-end">
        <Button onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}
