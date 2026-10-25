// Create the polling agent on Retell: a Retell LLM holding the interviewer
// prompt, plus an agent that points at it. Prints the agent ID to put in
// RETELL_AGENT_ID.
//
// Tools, post-call analysis fields and the webhook URL are NOT set here —
// they need the deployed base URL, so `npm run retell:sync` adds them once
// the Worker is live.
//
//   npm run retell:create-agent -- --list-voices
//   npm run retell:create-agent -- --voice <voice_id> --dry-run
//   npm run retell:create-agent -- --voice <voice_id>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { retellApi } from "../lib/polling/retell";

const DEFAULTS = {
  name: "Cayman Poll Interviewer",
  language: "en-US",
  model: "claude-5.5-sonnet",
};

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function listVoices(): Promise<void> {
  const voices = (await retellApi("GET", "/list-voices")) as Record<string, unknown>[];
  const rows = voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.voice_name,
    provider: v.provider,
    gender: v.gender,
    accent: v.accent,
    age: v.age,
  }));
  console.log(`${rows.length} voices available.\n`);
  // English-accented voices first — this agent calls Cayman respondents.
  const english = rows.filter((r) => /american|british|canadian|caribbean|australian/i.test(String(r.accent ?? "")));
  console.table(english.length ? english : rows);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (!process.env.RETELL_API_KEY) throw new Error("RETELL_API_KEY is required");

  if (args.has("--list-voices")) return listVoices();

  const voiceId = flag("voice");
  if (!voiceId) {
    throw new Error("--voice <voice_id> is required. Run with --list-voices to see the options.");
  }

  const agentName = flag("name") ?? DEFAULTS.name;
  const language = flag("language") ?? DEFAULTS.language;
  const model = flag("model") ?? DEFAULTS.model;
  const dryRun = args.has("--dry-run");

  // Don't quietly create a second agent on a re-run.
  if (!args.has("--force") && !dryRun) {
    const existing = (await retellApi("GET", "/list-agents")) as { agent_id: string; agent_name?: string }[];
    const clash = existing.find((a) => a.agent_name === agentName);
    if (clash) {
      throw new Error(
        `An agent named "${agentName}" already exists (${clash.agent_id}). ` +
          "Use --name for a different name, or --force to create another anyway."
      );
    }
  }

  const llmPayload = {
    model,
    general_prompt: readFileSync(join(process.cwd(), "retell/poll-agent-prompt.md"), "utf8"),
    start_speaker: "agent",
    // The prompt opens the call itself, so no canned first line.
    begin_message: null,
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        { llmPayload: { ...llmPayload, general_prompt: `<${llmPayload.general_prompt.length} chars>` },
          agentPayload: { agent_name: agentName, voice_id: voiceId, language, response_engine: { type: "retell-llm", llm_id: "<new>" } } },
        null,
        2
      )
    );
    return;
  }

  const llm = await retellApi("POST", "/create-retell-llm", llmPayload);
  console.log(`Created Retell LLM ${llm.llm_id} (model ${model})`);

  const agent = await retellApi("POST", "/create-agent", {
    agent_name: agentName,
    voice_id: voiceId,
    language,
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
  });

  console.log(`Created agent ${agent.agent_id} ("${agentName}", ${language}, voice ${voiceId})`);
  console.log(`\nRETELL_AGENT_ID=${agent.agent_id}`);
  console.log("\nNext: deploy, then `npm run retell:sync` to push tools, analysis fields and the webhook URL.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
