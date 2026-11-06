import { spawn } from "node:child_process";
import { parseYoutubeLink } from "@/lib/url";
import { ytdlpAvailable, ytdlpAllowed } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Somente local: extrai o áudio com yt-dlp e o transmite ao navegador. */
export async function GET(req: Request) {
  if (!ytdlpAllowed() || !ytdlpAvailable()) {
    return Response.json({ error: "Recurso indisponível neste ambiente." }, { status: 404 });
  }
  const parsed = parseYoutubeLink(new URL(req.url).searchParams.get("url") ?? "");
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  // Somente o videoId validado vai para o processo (sem URL do usuário, sem shell).
  const child = spawn(
    "yt-dlp",
    ["--no-playlist", "--no-warnings", "-f", "bestaudio/best", "-o", "-", `https://www.youtube.com/watch?v=${parsed.videoId}`],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  const kill = () => {
    if (!child.killed) child.kill();
  };
  req.signal.addEventListener("abort", kill);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (d: Buffer) => controller.enqueue(new Uint8Array(d)));
      child.stdout.on("end", () => {
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      });
      child.on("error", (e) => controller.error(e));
      child.on("close", (code) => {
        if (code !== 0) {
          try {
            controller.error(new Error(stderr || `yt-dlp saiu com código ${code}`));
          } catch {
            /* ignore */
          }
        }
      });
    },
    cancel: kill,
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
