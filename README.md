# Transcritor

Transcreve vídeos com precisão e traz um assistente embutido para trabalhar o texto. **Tudo gratuito, sem cartão de crédito e sem custo por uso.**

- Next.js (App Router) + TypeScript + Tailwind CSS, pronto para Vercel (Hobby) ou Cloudflare Pages
- Extração de áudio no navegador com ffmpeg.wasm
- Dois motores: **Local** (Whisper no navegador, privado) e **Groq** (Whisper na nuvem, rápido)
- Entradas: arquivo, Google Drive, YouTube (legendas) e um **Extrator de áudio** independente
- Assistente (Groq `openai/gpt-oss-120b` ou Google Gemini free tier), com chave só no servidor
- Histórico no navegador (IndexedDB), sem login

## Instalação e execução

```bash
npm install
cp .env.example .env.local   # preencha as chaves gratuitas (todas opcionais)
npm run dev
```

Abra http://localhost:3000. Sem nenhuma chave, a transcrição **Local** e o Extrator de áudio já funcionam.

## Chaves gratuitas

| Variável | Para quê | Como obter |
| --- | --- | --- |
| `GROQ_API_KEY` | Motor Groq e Assistente (padrão) | Crie em https://console.groq.com/keys (sem cartão) |
| `GEMINI_API_KEY` + `AI_PROVIDER=gemini` | Assistente com Gemini | https://aistudio.google.com/apikey |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | Download de arquivos públicos do Drive | Passo a passo abaixo |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Login Google (arquivos privados do Drive) | Passo a passo abaixo |
| `ENABLE_YTDLP` | Áudio do YouTube via yt-dlp (só local) | `true` para habilitar fora do `npm run dev` |

Chaves sem o prefixo `NEXT_PUBLIC_` ficam apenas no servidor e nunca chegam ao navegador. As duas `NEXT_PUBLIC_` são públicas por natureza e devem ser **restritas por domínio**.

### Google Drive (Google Cloud Console, sem cartão)

1. Acesse https://console.cloud.google.com e crie um projeto.
2. **APIs e serviços → Biblioteca → Google Drive API → Ativar.**
3. **Credenciais → Criar credenciais → Chave de API.** Em “Restrições de aplicativo”, escolha *Referenciadores HTTP* e adicione `http://localhost:3000/*` e o domínio do deploy. Em “Restrições de API”, selecione só a Drive API. Use como `NEXT_PUBLIC_GOOGLE_API_KEY`.
4. **Tela de consentimento OAuth:** tipo *Externo*, preencha o nome do app e adicione-se como usuário de teste. Escopo: `.../auth/drive.readonly`.
5. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web.** Em “Origens JavaScript autorizadas”, adicione `http://localhost:3000` e o domínio do deploy. Use como `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

Sem essas duas variáveis a aba “Google Drive” fica desabilitada, com uma dica explicando o que fazer.

- **Arquivos públicos** (“qualquer pessoa com o link”): baixados direto no navegador pela Drive API v3 (`alt=media`), sem passar pelo servidor, sem limite de tempo da Vercel e sem a página de “aviso de vírus”.
- **Arquivos privados:** botão “Entrar com Google” (Google Identity Services). O token fica **somente em memória** e nunca é enviado ao servidor.

## Motores de transcrição

- **Local (privado):** Whisper via Transformers.js em Web Worker (WebGPU quando disponível, com fallback para WASM). O vídeo não sai do computador. O modelo é baixado na primeira vez e fica em cache. Modelos: Rápido (`whisper-base`), Equilibrado (`whisper-small`, padrão) e Máxima precisão (`whisper-large-v3-turbo`, só com WebGPU).
- **Groq (nuvem):** `whisper-large-v3-turbo` no plano gratuito. O áudio é extraído e comprimido no navegador e enviado em janelas de ~10 min (< 4 MB cada, abaixo do limite de body da Vercel Hobby). Erros 429 têm retry com backoff e mensagem sugerindo o motor Local.

## Pipeline de áudio (vídeos longos, 1 a 4 h)

O vídeo **nunca** é carregado inteiro na memória:

1. O arquivo é montado no ffmpeg.wasm com **WORKERFS** (`ffmpeg.mount('WORKERFS', …)`), lido do disco sob demanda.
2. Só o áudio é extraído (`-vn`, mono, 16 kHz, Opus 24 kbps ≈ 11 MB/hora). Se houver várias faixas de áudio, você escolhe qual usar.
3. O áudio extraído vira um Blob pequeno (download, preview e transcrição).
4. A transcrição trabalha por **janelas de ~10 min com 2 s de sobreposição**: cada janela é decodificada para PCM 16 kHz, transcrita, tem o offset somado aos timestamps, a sobreposição é deduplicada e a memória é liberada antes da próxima.
5. As janelas concluídas são salvas no IndexedDB. Se a aba fechar, envie o mesmo arquivo novamente (mesmo motor/modelo/idioma/faixa) e a transcrição **retoma de onde parou**.
6. Cancelar encerra o worker e desmonta o WORKERFS. A Screen Wake Lock API evita a suspensão durante o processamento.

Para o Drive, o download é gravado direto em disco na **Origin Private File System** (OPFS), verificando o espaço com `navigator.storage.estimate()`, e o arquivo temporário é removido ao fechar a transcrição ou cancelar.

O ffmpeg.wasm roda em worker dedicado, é carregado sob demanda (lazy), com o core em cache (Cache API). Usa a versão multi-thread quando `crossOriginIsolated` é verdadeiro e a single-thread como fallback.

### Dicas e limites

- Use **Chrome ou Edge atualizados no computador**; Safari e navegadores móveis têm limites menores de memória e de armazenamento (OPFS).
- Arquivos acima de 2 GB funcionam, mas podem demorar.
- Para vídeos muito longos, o motor **Groq** é bem mais rápido; no plano gratuito há um limite de horas de áudio por hora, então vídeos de 3 a 4 h podem exigir pausas ou o motor Local.
- No **Extrator de áudio**, a opção “Original” copia a faixa sem recodificar (instantâneo). WAV de várias horas é grande (≈ 115 MB/h): prefira Opus ou MP3.
- Se o vídeo for gigante, extraia o áudio na aba “Extrair áudio”, baixe-o e transcreva o áudio.

## YouTube

- **Legendas** (`/api/youtube/captions`, funciona na nuvem e local): manuais primeiro, depois automáticas, com seletor de idioma. A origem aparece como “Legendas do YouTube” e a precisão depende da legenda original. O player oficial (IFrame Player API) faz seek ao clicar em um trecho.
- **Áudio com Whisper (somente local):** com `yt-dlp` e `ffmpeg` instalados no sistema e `npm run dev` (ou `ENABLE_YTDLP=true`), aparece o botão “Transcrever o áudio com Whisper”. A rota é **desabilitada na Vercel/produção**: IPs de nuvem são bloqueados pelo YouTube e baixar o vídeo viola os Termos de Serviço.
- Sem legendas, vídeo privado, com restrição de idade ou transmissão ao vivo: mensagens específicas com as alternativas (enviar o arquivo na aba Arquivo).

## Segurança

- Somente `https`; hosts permitidos: `drive.google.com`, `docs.google.com`, `youtube.com`, `youtu.be`, `m.youtube.com`, `music.youtube.com`. URLs são validadas no cliente e no servidor.
- Rotas protegidas contra SSRF: o servidor extrai o `videoId` validado e nunca busca a URL fornecida pelo usuário; URLs de legenda devolvidas pelo YouTube só são buscadas se o host for `*.youtube.com`.
- Nenhuma chave secreta no cliente.

## Deploy gratuito na Vercel (Hobby)

1. Envie o projeto para um repositório no GitHub.
2. Em https://vercel.com/new importe o repositório (framework: Next.js, sem alterações).
3. Em *Settings → Environment Variables*, adicione `GROQ_API_KEY` (e, se quiser, `GEMINI_API_KEY`, `AI_PROVIDER`, `NEXT_PUBLIC_GOOGLE_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
4. Faça o deploy. Depois, adicione o domínio final nas restrições da API key e do OAuth client do Google.

Os headers `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: credentialless` estão em `next.config.ts` (habilitam o ffmpeg multi-thread). Confira no deploy: no console do navegador, `crossOriginIsolated` deve retornar `true`. O player do YouTube usa `<iframe credentialless>` para continuar funcionando com esses headers (Chrome/Edge).

## Estrutura

```
app/            páginas e rotas (api/ai, api/transcribe-groq, api/youtube/*, api/config)
components/     interface (input/, ui/, player, transcrição, assistente…)
lib/            formatadores, URLs, Drive, YouTube, whisper, groq, transcribe, db
lib/audio/      extract.ts, windows.ts, opfs.ts, ffmpeg.ts
lib/ai/         providers (servidor) e cliente com map-reduce
workers/        whisper.worker.ts
app/tokens.css  tokens de design (cores, raios, sombras, movimento)
```

## Scripts

```bash
npm run dev     # desenvolvimento
npm run build   # build de produção (TypeScript + lint)
npm run lint
```
