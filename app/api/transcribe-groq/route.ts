export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return Response.json({ error: "GROQ_API_KEY não configurada. Crie uma chave gratuita em console.groq.com." }, { status: 503 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) return Response.json({ error: "Arquivo ausente." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Trecho de áudio maior que 4 MB." }, { status: 413 });

  const out = new FormData();
  out.append("file", file, "chunk.ogg");
  out.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo");
  out.append("response_format", "verbose_json");
  out.append("temperature", "0");
  out.append("timestamp_granularities[]", "segment");
  out.append("timestamp_granularities[]", "word");
  const lang = form.get("language");
  if (typeof lang === "string" && /^[a-z]{2,3}$/.test(lang)) out.append("language", lang);

  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return Response.json({ error: "A Groq demorou para responder. Tente novamente." }, { status: 504 });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const headers: Record<string, string> = {};
    const ra = res.headers.get("retry-after");
    if (ra) headers["Retry-After"] = ra;
    return Response.json(
      { error: res.status === 429 ? "Limite de áudio por hora da Groq atingido." : `Erro da Groq (${res.status}). ${text.slice(0, 160)}` },
      { status: res.status === 401 ? 401 : res.status === 429 ? 429 : 502, headers },
    );
  }
  const j = (await res.json()) as {
    segments?: { start: number; end: number; text: string }[];
    words?: { start: number; end: number; word: string }[];
    text?: string;
    duration?: number;
  };
  const words = j.words ?? [];
  const segments = (j.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
    words: words
      .filter((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05)
      .map((w) => ({ start: w.start, end: w.end, text: w.word })),
  }));
  if (segments.length === 0 && j.text?.trim()) {
    segments.push({ start: 0, end: j.duration ?? 0, text: j.text.trim(), words: [] });
  }
  return Response.json({ segments });
}
