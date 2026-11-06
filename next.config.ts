import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // COOP/COEP habilitam crossOriginIsolated (SharedArrayBuffer), necessário
  // para o ffmpeg.wasm multi-thread. "credentialless" mantém recursos de
  // terceiros (CDN, miniaturas) funcionando sem exigir CORP nos mesmos.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  serverExternalPackages: ["youtubei.js"],
};

export default nextConfig;
