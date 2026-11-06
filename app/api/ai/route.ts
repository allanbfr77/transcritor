import { ProviderError, providerConfigured, streamChat, type ChatMessage } from "@/lib/ai/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CHARS = 60_000;

export async function POST(req: Request) {
  if (!providerConfigured()) {
    return Response.json({ error: "A IA não está configurada. Defina GROQ_API_KEY ou GEMINI_API_KEY." }, { status: 503 });
  }
  let body: { system?: string; messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const messages = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );
  const total = messages.reduce((n, m) => n + m.content.length, 0) + (body.system?.length ?? 0);
  if (messages.length === 0 || total > MAX_CHARS) {
    return Response.json({ error: "Texto vazio ou grande demais." }, { status: 413 });
  }
  const system = typeof body.system === "string" ? body.system : "Você é um assistente útil. Responda em português do Brasil.";

  const iter = streamChat(system, messages, req.signal);
  // Busca o primeiro trecho antes de abrir a resposta para devolver erros HTTP corretos.
  let first: IteratorResult<string>;
  try {
    first = await iter.next();
  } catch (e) {
    if (e instanceof ProviderError) {
      return Response.json(
        { error: e.message },
        { status: e.status === 429 ? 429 : 502, headers: e.retryAfter ? { "Retry-After": String(e.retryAfter) } : undefined },
      );
    }
    return Response.json({ error: "Falha ao consultar a IA." }, { status: 502 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(enc.encode(first.value));
        if (!first.done) {
          for await (const chunk of iter) controller.enqueue(enc.encode(chunk));
        }
      } catch {
        /* conexão encerrada */
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
