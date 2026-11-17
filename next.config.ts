import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "space-z.ai",
    "*.space-z.ai",
    "preview-chat-7796ea67-bcb1-4d43-9046-c1bdb03026ad.space-z.ai",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
