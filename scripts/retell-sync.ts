// Push the polling agent's tools, post-call analysis fields and webhook to
// Retell. Tools and fields not managed here are left as they are.
//
//   npm run retell:sync              # tools + analysis + webhook
//   npm run retell:sync -- --prompt  # also replace the prompt with retell/poll-agent-prompt.md
//   npm run retell:sync -- --dry-run # print what would be sent

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildGeneralTools,
  MANAGED_TOOL_NAMES,
  POST_CALL_ANALYSIS_DATA,
  WEBHOOK_EVENTS,
} from "../lib/polling/config";
import { retellApi } from "../lib/polling/retell";

type Named = { name?: string };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Ours replace same-named entries; everything else is kept.
function merge<T extends Named>(existing: T[] | null | undefined, ours: T[], managed: readonly string[]): T[] {
  const keep = (existing ?? []).filter((t) => !t.name || !managed.includes(t.name));
  return [...keep, ...ours];
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");

  const agentId = required("RETELL_AGENT_ID");
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? required("NEXTAUTH_URL")).replace(/\/$/, "");
  if (!baseUrl.startsWith("https://")) {
    console.warn(`Warning: ${baseUrl} is not HTTPS; Retell can't reach localhost.`);
  }

  const agent = await retellApi("GET", `/get-agent/${agentId}`);
  if (agent.response_engine?.type !== "retell-llm") {
    throw new Error(
      `Agent ${agentId} uses response engine "${agent.response_engine?.type}". ` +
        "This script supports Single/Multi Prompt (retell-llm) agents only."
    );
  }
  const llmId: string = agent.response_engine.llm_id;
  const llm = await retellApi("GET", `/get-retell-llm/${llmId}`);

  const ourTools = buildGeneralTools({
    functionsUrl: `${baseUrl}/api/retell/functions`,
    transferNumber: process.env.RETELL_TRANSFER_NUMBER || undefined,
  });
  const llmPatch: Record<string, unknown> = {
    general_tools: merge(llm.general_tools, ourTools as Named[], MANAGED_TOOL_NAMES),
  };
  if (args.has("--prompt")) {
    llmPatch.general_prompt = readFileSync(join(process.cwd(), "retell/poll-agent-prompt.md"), "utf8");
  }

  const ourFields = POST_CALL_ANALYSIS_DATA as Named[];
  const agentPatch = {
    post_call_analysis_data: merge(
      agent.post_call_analysis_data,
      ourFields,
      ourFields.map((f) => f.name!)
    ),
    webhook_url: `${baseUrl}/api/retell/webhook`,
    webhook_events: WEBHOOK_EVENTS,
  };

  if (dryRun) {
    console.log(JSON.stringify({ llmId, llmPatch, agentId, agentPatch }, null, 2));
    return;
  }

  await retellApi("PATCH", `/update-retell-llm/${llmId}`, llmPatch);
  await retellApi("PATCH", `/update-agent/${agentId}`, agentPatch);

  const toolNames = (llmPatch.general_tools as Named[]).map((t) => t.name).join(", ");
  console.log(`Updated LLM ${llmId}: tools = ${toolNames}`);
  if (llmPatch.general_prompt) console.log("  prompt replaced from retell/poll-agent-prompt.md");
  console.log(`Updated agent ${agentId}: ${agentPatch.post_call_analysis_data.length} analysis fields`);
  console.log(`  webhook -> ${agentPatch.webhook_url}`);
  console.log("If the agent uses versions, publish the new draft in the Retell dashboard.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
