import "server-only";
import { spawnSync } from "node:child_process";

/** O caminho yt-dlp só é permitido em desenvolvimento local ou com ENABLE_YTDLP=true (nunca na Vercel). */
export function ytdlpAllowed(): boolean {
  if (process.env.VERCEL) return false;
  return process.env.NODE_ENV === "development" || process.env.ENABLE_YTDLP === "true";
}

let cached: boolean | null = null;

function hasBinary(cmd: string, arg: string): boolean {
  try {
    const r = spawnSync(cmd, [arg], { stdio: "ignore", timeout: 5000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function ytdlpAvailable(): boolean {
  if (!ytdlpAllowed()) return false;
  if (cached === null) cached = hasBinary("yt-dlp", "--version") && hasBinary("ffmpeg", "-version");
  return cached;
}
