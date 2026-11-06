import "server-only";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type Provider = "groq" | "gemini";

export function getProvider(): Provider {
  return process.env.AI_PROVIDER === "gemini" ? "gemini" : "groq";
}

export function providerConfigured(p: Provider = getProvider()): boolean {
  return p === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.GROQ_API_KEY;
}

export class ProviderError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) {
    super(message);
  }
}

function friendly(status: number, body: string): string {
  if (status === 401 || status === 403) return "A chave da IA é inválida ou não tem permissão.";
  if (status === 429) return "Limite do plano gratuito da IA atingido. Aguarde alguns instantes e tente novamente.";
  if (status === 413) return "O texto é grande demais para este plano gratuito.";
  return `Falha ao consultar a IA (código ${status}). ${body.slice(0, 120)}`;
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

async function* groqStream(system: string, messages: ChatMessage[], signal: AbortSignal) {
  // Tenta o modelo configurado e, se ele não existir mais, os modelos de reserva.
  const models = [process.env.GROQ_CHAT_MODEL, ...GROQ_MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let res: Response | null = null;
  let lastErr: ProviderError | null = null;
  for (const model of models) {
    const body: Record<string, unknown> = {
      model,
      stream: true,
      temperature: 0.3,
      messages: [{ role: "system", content: system }, ...messages],
    };
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      res = r;
      break;
    }
    const text = await r.text().catch(() => "");
    lastErr = new ProviderError(friendly(r.status, text), r.status, Number(r.headers.get("retry-after")) || undefined);
    if (r.status !== 404 && !(r.status === 400 && /model/i.test(text))) throw lastErr;
  }
  if (!res) throw lastErr ?? new ProviderError("Nenhum modelo da Groq disponível.", 502);
  for await (const data of sseLines(res)) {
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t;
    } catch {
      /* ignora linhas parciais */
    }
  }
}

async function* geminiStream(system: string, messages: ChatMessage[], signal: AbortSignal) {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.3 },
      }),
    },
  );
  if (!res.ok) throw new ProviderError(friendly(res.status, await res.text().catch(() => "")), res.status);
  for await (const data of sseLines(res)) {
    try {
      const j = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
      if (t) yield t;
    } catch {
      /* ignore */
    }
  }
}

export function streamChat(system: string, messages: ChatMessage[], signal: AbortSignal) {
  return getProvider() === "gemini" ? geminiStream(system, messages, signal) : groqStream(system, messages, signal);
}
