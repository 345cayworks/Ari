import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is dynamic (force-dynamic), so no incremental cache is needed.
export default defineCloudflareConfig({});
