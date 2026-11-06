import { Innertube, Log } from "youtubei.js";
import { parseYoutubeLink } from "@/lib/url";
import type { Segment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

Log.setLevel(Log.Level.NONE);

interface CaptionTrackRaw {
  base_url: string;
  language_code: string;
  kind?: string;
  name?: { text?: string };
}

// Limite simples por IP (memória da instância) para respeitar o YouTube.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 12;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

let tubePromise: Promise<Innertube> | null = null;
const tube = () => (tubePromise ??= Innertube.create({ retrieve_player: false }));

interface InfoLike {
  basic_info: { title?: string; author?: string; duration?: number; is_live?: boolean; is_upcoming?: boolean; is_private?: boolean };
  playability_status?: { status?: string; reason?: string };
  captions?: { caption_tracks?: CaptionTrackRaw[] };
}

async function loadInfo(videoId: string): Promise<{ info: InfoLike; tracks: CaptionTrackRaw[] } | null> {
  const yt = await tube();
  let last: InfoLike | null = null;
  for (const client of ["ANDROID", "IOS", "WEB"] as const) {
    try {
      const info = (await withTimeout(yt.getInfo(videoId, { client }), 20_000)) as unknown as InfoLike;
      last = info;
      const tracks = info.captions?.caption_tracks ?? [];
      if (tracks.length) return { info, tracks };
    } catch (e) {
      if (client === "WEB" && !last) throw e;
    }
  }
  return last ? { info: last, tracks: [] } : null;
}

function fail(error: string, code: string, status = 422) {
  return Response.json({ error, code }, { status });
}

export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return fail("Muitas consultas em pouco tempo. Aguarde um minuto e tente novamente.", "rate", 429);

  const sp = new URL(req.url).searchParams;
  const parsed = parseYoutubeLink(sp.get("url") ?? "");
  if (!parsed.ok) return fail(parsed.error, "invalid", 400);
  const wantLang = sp.get("lang");
  const wantKind = sp.get("kind");

  let loaded: Awaited<ReturnType<typeof loadInfo>>;
  try {
    loaded = await loadInfo(parsed.videoId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "timeout") return fail("O YouTube demorou demais para responder. Tente novamente em instantes.", "timeout", 504);
    if (/private/i.test(msg)) return fail("Este vídeo é privado.", "private");
    if (/unavailable|not found|does not exist/i.test(msg)) return fail("Vídeo indisponível ou inexistente.", "unavailable", 404);
    return fail(
      "O YouTube bloqueou ou não respondeu à consulta. Envie o arquivo do vídeo na aba Arquivo ou, se estiver rodando localmente, use a transcrição do áudio.",
      "blocked",
      502,
    );
  }
  if (!loaded) return fail("Vídeo indisponível.", "unavailable", 404);
  const { info, tracks } = loaded;
  const ps = info.playability_status;
  const reason = ps?.reason ?? "";
  if (info.basic_info.is_private) return fail("Este vídeo é privado.", "private");
  if (/age|idade/i.test(reason) && ps?.status !== "OK") return fail("Este vídeo tem restrição de idade e não pode ser consultado.", "age");
  if (info.basic_info.is_live && !info.basic_info.is_upcoming && (info.basic_info.duration ?? 0) === 0)
    return fail("Transmissões ao vivo em andamento não podem ser transcritas. Tente depois que terminar.", "live");
  if (info.basic_info.is_upcoming) return fail("Esta transmissão ainda não começou.", "live");
  if (ps?.status && ps.status !== "OK" && tracks.length === 0) {
    if (/private|privado/i.test(reason)) return fail("Este vídeo é privado.", "private");
    return fail(reason || "Vídeo indisponível.", "unavailable");
  }
  if (tracks.length === 0) {
    return fail(
      "Este vídeo não tem legendas disponíveis (ou o YouTube bloqueou a consulta). Envie o arquivo do vídeo na aba Arquivo ou, se estiver rodando localmente, transcreva o áudio com Whisper.",
      "no-captions",
    );
  }

  const list = tracks.map((t) => ({
    lang: t.language_code,
    name: t.name?.text ?? t.language_code,
    auto: t.kind === "asr",
  }));
  const pick =
    list.find((t) => wantLang && t.lang === wantLang && (wantKind ? t.auto === (wantKind === "asr") : true)) ??
    list.find((t) => !t.auto) ??
    list[0];
  const raw = tracks.find((t) => t.language_code === pick.lang && (t.kind === "asr") === pick.auto)!;

  let base: URL;
  try {
    base = new URL(raw.base_url);
  } catch {
    return fail("Legenda inválida retornada pelo YouTube.", "bad-caption", 502);
  }
  if (base.protocol !== "https:" || !(base.hostname === "youtube.com" || base.hostname.endsWith(".youtube.com"))) {
    return fail("Legenda inválida retornada pelo YouTube.", "bad-caption", 502);
  }
  base.searchParams.set("fmt", "json3");

  let events: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] = [];
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { events?: typeof events };
    events = j.events ?? [];
  } catch {
    return fail("Não foi possível baixar a legenda do YouTube agora. Tente novamente ou envie o arquivo.", "blocked", 502);
  }

  const segments: Segment[] = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s) => s.utf8 ?? "").join("").replace(/\s*\n\s*/g, " ").trim();
    if (!text) continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    const end = start + (ev.dDurationMs ?? 2000) / 1000;
    segments.push({ id: `y${segments.length}`, start, end, text });
  }
  // Remove sobreposição de legendas automáticas (cada trecho termina quando o próximo começa)
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].end > segments[i + 1].start) segments[i].end = Math.max(segments[i].start + 0.1, segments[i + 1].start);
  }
  if (segments.length === 0) return fail("A legenda está vazia.", "no-captions");

  const duration = info.basic_info.duration || segments[segments.length - 1].end;
  return Response.json({
    videoId: parsed.videoId,
    title: info.basic_info.title ?? "Vídeo do YouTube",
    channel: info.basic_info.author ?? "",
    duration,
    tracks: list,
    selected: pick,
    segments,
  });
}
