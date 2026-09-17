import type { NextConfig } from "next";
import path from "path";

const CHAT_API =
  process.env.NEXT_PUBLIC_CHAT_API_URL || "http://localhost:4001";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  env: {
    NEXT_PUBLIC_CHAT_API_URL: CHAT_API,
  },
  // AI 助手 SSE 代理（来自 autix-demo chat-web）
  rewrites: async () => [
    {
      source: "/api/sse/:path*",
      destination: `${CHAT_API}/api/sse/:path*`,
    },
  ],
};

export default nextConfig;
