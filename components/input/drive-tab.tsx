"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, X } from "lucide-react";
import {
  downloadDriveFile,
  getDriveMeta,
  hasDriveToken,
  signInGoogle,
  signOutGoogle,
  type DownloadProgress,
  type DriveMeta,
} from "@/lib/drive";
import { parseDriveLink, type LinkKind } from "@/lib/url";
import { formatBytes } from "@/lib/format";
import { AppError, isAbort } from "@/lib/types";
import { supportsOpfs } from "@/lib/audio/opfs";
import { Banner, Button, ProgressBar } from "../ui/primitives";
import { LinkField, MetaRow } from "./shared";

const LARGE = 1.5 * 1024 ** 3;

export function DriveTab({
  onReady,
  onWrongKind,
  initialUrl,
}: {
  onReady: (file: File, meta: DriveMeta, url: string, cleanup: () => Promise<void>) => void;
  onWrongKind: (k: LinkKind, v: string) => void;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [meta, setMeta] = useState<DriveMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needAuth, setNeedAuth] = useState(false);
  const [signed, setSigned] = useState(hasDriveToken());
  const [prog, setProg] = useState<DownloadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = async () => {
    setError(null);
    setNeedAuth(false);
    setMeta(null);
    setProg(null);
    const p = parseDriveLink(url);
    if (!p.ok) return setError(p.error);
    if (!supportsOpfs()) {
      return setError("Seu navegador não suporta armazenamento em disco (OPFS) para arquivos grandes. Use o Chrome ou o Edge atualizado no computador.");
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      const m = await getDriveMeta(p.ref, ac.signal);
      setMeta(m);
      const { file, cleanup } = await downloadDriveFile(p.ref, m, setProg, ac.signal);
      onReady(file, m, p.url, cleanup);
      setMeta(null);
      setProg(null);
    } catch (e) {
      if (isAbort(e)) setError("Download cancelado.");
      else {
        setError(e instanceof Error ? e.message : "Falha ao baixar o arquivo.");
        if (e instanceof AppError && e.code === "drive-access") setNeedAuth(true);
      }
      setProg(null);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    try {
      await signInGoogle();
      setSigned(true);
      setError(null);
      setNeedAuth(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no login.");
    }
  };

  const pct = prog && prog.total > 0 ? (prog.loaded / prog.total) * 100 : null;

  return (
    <div className="space-y-3">
      <LinkField
        value={url}
        onChange={setUrl}
        onSubmit={load}
        kind="drive"
        onWrongKind={onWrongKind}
        busy={busy}
        placeholder="Cole o link do arquivo no Google Drive"
      />
      <p className="text-[12px] leading-5 text-fg-3">
        Arquivos com compartilhamento “qualquer pessoa com o link” baixam direto. Para arquivos privados, entre com o Google (somente leitura; o token fica só na memória deste navegador).
      </p>

      {meta && (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4">
          <MetaRow items={[["Arquivo", meta.name], ["Tamanho", formatBytes(meta.size)], ["Tipo", meta.mimeType]]} />
          {meta.size > LARGE && (
            <Banner tone="warning">
              Arquivo grande (acima de ~1,5 GB). Ele é gravado em disco durante o download; se faltar espaço, baixe só o áudio antes ou use um arquivo menor.
            </Banner>
          )}
          {prog && (
            <div className="space-y-1.5" aria-live="polite">
              <ProgressBar percent={pct} />
              <div className="tnum flex justify-between text-[12px] text-fg-2">
                <span>
                  {formatBytes(prog.loaded)} / {formatBytes(prog.total)}
                </span>
                <span>{formatBytes(prog.speed)}/s</span>
              </div>
            </div>
          )}
          {busy && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => abortRef.current?.abort()}>
                <X size={14} strokeWidth={1.75} />
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="flex flex-wrap items-center gap-2">
        {signed ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              signOutGoogle();
              setSigned(false);
            }}
          >
            <LogOut size={14} strokeWidth={1.75} />
            Sair da conta Google
          </Button>
        ) : (
          <Button size="sm" variant={needAuth ? "primary" : "secondary"} onClick={signIn}>
            <LogIn size={14} strokeWidth={1.75} />
            Entrar com Google
          </Button>
        )}
      </div>
    </div>
  );
}
