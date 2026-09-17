import type { NextConfig } from "next";
import path from "path";

const USER_API =
  process.env.NEXT_PUBLIC_USER_API_URL || "http://localhost:4002/api/v1";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  env: {
    NEXT_PUBLIC_USER_API_URL: USER_API,
  },
};

export default nextConfig;
