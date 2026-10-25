import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Left to OpenNext's bundler, which picks Prisma's Workers build.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@anthropic-ai/sdk"],
};

export default nextConfig;

// Lets `next dev` read bindings and .dev.vars like the deployed Worker.
initOpenNextCloudflareForDev();
