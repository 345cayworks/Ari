import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Left to OpenNext's bundler, which picks Prisma's Workers build.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@anthropic-ai/sdk"],
  // Two packages pick their implementation through export conditions, and
  // Next's tracer resolves those as Node while OpenNext bundles as workerd.
  // The files the Worker build needs are therefore never copied, so name them.
  //
  // @anthropic-ai/sdk 0.40.x: the tracer copies _shims/auto/runtime-node.mjs,
  // but the workerd condition wants _shims/auto/runtime.mjs and the build
  // fails to resolve it.
  //
  // .prisma/client: the tracer copies index.js plus a native query engine for
  // the build machine (query_engine-windows.dll.node here). The workerd
  // condition wants wasm.js, query_engine_bg.wasm and wasm-worker-loader.mjs,
  // which never reach esbuild — so every query on the deployed Worker died
  // with "could not locate the Query Engine". binaryTargets cannot fix that;
  // workerd cannot execute a binary.
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/@anthropic-ai/sdk/_shims/**",
      "./node_modules/.prisma/client/**",
    ],
  },
};

export default nextConfig;

// Lets `next dev` read bindings and .dev.vars like the deployed Worker.
initOpenNextCloudflareForDev();
