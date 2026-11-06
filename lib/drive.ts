import { AppError } from "./types";
import { checkSpace, createTempFile } from "./audio/opfs";
import type { DriveRef } from "./url";

export const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const driveConfigured = !!GOOGLE_API_KEY && !!GOOGLE_CLIENT_ID;

export interface DriveMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

let accessToken: string | null = null; // somente em memória
export const hasDriveToken = () => !!accessToken;

interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string;
        scope: string;
        callback: (r: { access_token?: string; error?: string }) => void;
        error_callback?: (e: { type: string }) => void;
      }) => TokenClient;
    };
  };
}

function loadGis(): Promise<GoogleGlobal> {
  const w = window as unknown as { google?: GoogleGlobal };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new AppError("Falha ao carregar o login do Google.", "gis")));
    s.onerror = () => reject(new AppError("Não foi possível carregar o login do Google. Verifique sua conexão.", "gis"));
    document.head.appendChild(s);
  });
}

export async function signInGoogle(): Promise<void> {
  if (!GOOGLE_CLIENT_ID) throw new AppError("NEXT_PUBLIC_GOOGLE_CLIENT_ID não configurado.", "config");
  const g = await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: (r) => {
        if (r.access_token) {
          accessToken = r.access_token;
          resolve();
        } else reject(new AppError("Não foi possível entrar com o Google.", "auth"));
      },
      error_callback: () => reject(new AppError("Login cancelado ou bloqueado pelo navegador.", "auth")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export function signOutGoogle() {
  accessToken = null;
}

function headers(ref: DriveRef): HeadersInit {
  const h: Record<string, string> = {};
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  if (ref.resourceKey) h["X-Goog-Drive-Resource-Keys"] = `${ref.fileId}/${ref.resourceKey}`;
  return h;
}

function endpoint(ref: DriveRef, query: string): string {
  const key = !accessToken && GOOGLE_API_KEY ? `&key=${encodeURIComponent(GOOGLE_API_KEY)}` : "";
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.fileId)}?${query}&supportsAllDrives=true${key}`;
}

function driveError(status: number): AppError {
  if (status === 403 || status === 404 || status === 401) {
    return new AppError(
      accessToken
        ? "Não foi possível acessar este arquivo com a sua conta. Verifique se você tem permissão."
        : "Não foi possível acessar o arquivo. Se ele for privado, clique em “Entrar com Google” e tente de novo.",
      "drive-access",
    );
  }
  if (status === 429) return new AppError("Limite de requisições do Google atingido. Tente novamente em alguns minutos.", "drive-rate");
  return new AppError(`O Google Drive retornou um erro (código ${status}).`, "drive");
}

export async function getDriveMeta(ref: DriveRef, signal?: AbortSignal): Promise<DriveMeta> {
  let res: Response;
  try {
    res = await fetch(endpoint(ref, "fields=id,name,size,mimeType"), { headers: headers(ref), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AppError("Sem conexão com o Google Drive.", "network");
  }
  if (!res.ok) throw driveError(res.status);
  const j = (await res.json()) as { id: string; name: string; size?: string; mimeType: string };
  if (!/^(video|audio)\//.test(j.mimeType) && !/\.(mp4|mov|mkv|webm|avi|mp3|wav|m4a|opus|flac|ogg)$/i.test(j.name)) {
    throw new AppError("Este arquivo não é um vídeo ou áudio.", "not-media");
  }
  return { id: j.id, name: j.name, size: Number(j.size ?? 0), mimeType: j.mimeType };
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  speed: number;
}

/** Baixa o arquivo gravando o stream direto em disco (OPFS), sem montar Blob na RAM. */
export async function downloadDriveFile(
  ref: DriveRef,
  meta: DriveMeta,
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<{ file: File; cleanup: () => Promise<void> }> {
  await checkSpace(meta.size);
  let res: Response;
  try {
    res = await fetch(endpoint(ref, "alt=media"), { headers: headers(ref), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new AppError("Sem conexão com o Google Drive.", "network");
  }
  if (!res.ok || !res.body) throw driveError(res.status);
  const tmp = await createTempFile(meta.name, meta.mimeType);
  const reader = res.body.getReader();
  let loaded = 0;
  const t0 = performance.now();
  let lastUi = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      await tmp.write(value);
      loaded += value.byteLength;
      const now = performance.now();
      if (now - lastUi > 250) {
        lastUi = now;
        onProgress({ loaded, total: meta.size, speed: loaded / Math.max(0.001, (now - t0) / 1000) });
      }
    }
    onProgress({ loaded, total: meta.size, speed: loaded / Math.max(0.001, (performance.now() - t0) / 1000) });
    const file = await tmp.finish();
    return { file, cleanup: tmp.remove };
  } catch (e) {
    await tmp.remove();
    if (signal.aborted) throw new DOMException("Cancelado", "AbortError");
    throw e;
  }
}
