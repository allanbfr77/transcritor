import { getProvider, providerConfigured } from "@/lib/ai/providers";
import { ytdlpAvailable } from "@/lib/server-env";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg: AppConfig = {
    groq: !!process.env.GROQ_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    aiProvider: getProvider(),
    aiConfigured: providerConfigured(),
    ytdlp: ytdlpAvailable(),
  };
  return Response.json(cfg, { headers: { "Cache-Control": "no-store" } });
}
