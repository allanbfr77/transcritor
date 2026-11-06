"use client";

import { Cloud, Cpu } from "lucide-react";
import { LANGUAGES, LOCAL_MODELS } from "@/lib/whisper";
import type { AppConfig, EngineId, LocalModelId } from "@/lib/types";
import { Segmented, Select, SwitchRow } from "../ui/primitives";

export interface Settings {
  engine: EngineId;
  model: LocalModelId;
  language: string;
  /** traduzir automaticamente para português do Brasil */
  translate: boolean;
}

export const GROQ_TIP = (
  <>
    Crie uma chave gratuita em console.groq.com, salve como GROQ_API_KEY no arquivo .env.local e reinicie o servidor.
  </>
);

export function engineOptions(config: AppConfig | null) {
  return [
    { value: "local" as const, label: "Local (privado)", icon: <Cpu size={14} strokeWidth={1.75} /> },
    {
      value: "groq" as const,
      label: "Groq (rápido)",
      icon: <Cloud size={14} strokeWidth={1.75} />,
      disabled: !config?.groq,
      tip: config?.groq ? undefined : GROQ_TIP,
    },
  ];
}

export function OptionsCard({
  settings,
  onChange,
  config,
  webgpu,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  config: AppConfig | null;
  webgpu: boolean;
}) {
  const model = LOCAL_MODELS.find((m) => m.id === settings.model) ?? LOCAL_MODELS[1];
  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-4">
      <div>
        <Segmented
          label="Motor de transcrição"
          full
          value={settings.engine}
          onChange={(engine) => onChange({ ...settings, engine })}
          options={engineOptions(config)}
        />
        <p className="mt-2 text-[13px] leading-5 text-fg-2">
          {settings.engine === "local"
            ? "Whisper no seu navegador. O vídeo não sai do computador; o modelo é baixado uma vez e fica em cache."
            : "Whisper large-v3-turbo na nuvem da Groq: bem mais rápido. O áudio é enviado à Groq para processamento."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] text-fg-2">
          Idioma
          <Select
            label="Idioma do áudio"
            className="mt-1 w-full"
            value={settings.language}
            onChange={(e) => onChange({ ...settings, language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>
        {settings.engine === "local" && (
          <label className="block text-[13px] text-fg-2">
            Modelo
            <Select
              label="Modelo do Whisper"
              className="mt-1 w-full"
              value={settings.model}
              onChange={(e) => onChange({ ...settings, model: e.target.value as LocalModelId })}
            >
              {LOCAL_MODELS.map((m) => (
                <option key={m.id} value={m.id} disabled={m.needsWebGpu && !webgpu}>
                  {m.label}
                  {m.needsWebGpu && !webgpu ? " (requer WebGPU)" : ""}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <div>
        <SwitchRow
          label="Traduzir para português do Brasil"
          checked={settings.translate}
          onChange={(translate) => onChange({ ...settings, translate })}
        />
        <p className="text-[12px] leading-5 text-fg-3">
          Se o áudio estiver em outro idioma, o texto é traduzido pelo assistente ao final (o original fica disponível em Exibição). Exige a IA configurada.
        </p>
      </div>
      {settings.engine === "local" && (
        <p className="text-[12px] leading-5 text-fg-3">
          {model.description}
          {!webgpu && " WebGPU indisponível neste navegador: usando WASM e o modelo de máxima precisão fica desabilitado (use o Chrome ou o Edge atualizado)."}
        </p>
      )}
    </div>
  );
}
