export type LinkKind = "drive" | "youtube" | "unknown";

export const ALLOWED_HOSTS = [
  "drive.google.com",
  "docs.google.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "music.youtube.com",
];

export interface ParsedUrl {
  ok: boolean;
  error?: string;
  url?: URL;
}

export function parseSafeUrl(raw: string): ParsedUrl {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Cole um link para continuar." };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "Esse texto não parece um link válido." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Use um link seguro (https)." };
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) {
    return {
      ok: false,
      error: "Link não suportado. Use um link do Google Drive ou do YouTube.",
    };
  }
  return { ok: true, url };
}

export function detectKind(raw: string): LinkKind {
  const p = parseSafeUrl(raw);
  if (!p.ok || !p.url) return "unknown";
  const h = p.url.hostname.toLowerCase();
  if (h === "drive.google.com" || h === "docs.google.com") return "drive";
  return "youtube";
}

export interface DriveRef {
  fileId: string;
  resourceKey?: string;
}

export type DriveParse =
  | { ok: true; ref: DriveRef; url: string }
  | { ok: false; error: string };

export function parseDriveLink(raw: string): DriveParse {
  const p = parseSafeUrl(raw);
  if (!p.ok || !p.url) return { ok: false, error: p.error ?? "Link inválido." };
  const u = p.url;
  if (u.hostname !== "drive.google.com" && u.hostname !== "docs.google.com") {
    return { ok: false, error: "Este não é um link do Google Drive." };
  }
  if (/\/drive\/(u\/\d+\/)?folders\//.test(u.pathname) || u.pathname.includes("/folderview")) {
    return {
      ok: false,
      error:
        "Esse é um link de pasta. Abra o arquivo de vídeo ou áudio no Drive e copie o link do arquivo.",
    };
  }
  let id: string | null = null;
  const m = u.pathname.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) id = m[1];
  if (!id) id = u.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return { ok: false, error: "Não encontrei o ID do arquivo nesse link do Drive." };
  }
  const resourceKey = u.searchParams.get("resourcekey") ?? undefined;
  return {
    ok: true,
    ref: { fileId: id, resourceKey },
    url: `https://drive.google.com/file/d/${id}/view`,
  };
}

export type YoutubeParse =
  | { ok: true; videoId: string; url: string }
  | { ok: false; error: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeLink(raw: string): YoutubeParse {
  const p = parseSafeUrl(raw);
  if (!p.ok || !p.url) return { ok: false, error: p.error ?? "Link inválido." };
  const u = p.url;
  const host = u.hostname.toLowerCase();
  if (host === "drive.google.com" || host === "docs.google.com") {
    return { ok: false, error: "Este não é um link do YouTube." };
  }
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.split("/")[1] ?? null;
  } else {
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1] ?? null;
  }
  if (!id || !YT_ID.test(id)) {
    if (u.pathname.startsWith("/playlist") || u.pathname.startsWith("/@") || u.pathname.startsWith("/channel")) {
      return { ok: false, error: "Esse link é de playlist ou canal. Use o link de um vídeo." };
    }
    return { ok: false, error: "Não encontrei o ID do vídeo nesse link do YouTube." };
  }
  return { ok: true, videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}
