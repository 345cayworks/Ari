import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { MessageRole } from "@prisma/client";
import { tools, toolDefinitions } from "./tools";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_SYSTEM_PROMPT = `You are Ari, a personal AI chief of staff. Your job is to take work off the user's plate: triaging information, thinking through decisions, drafting communications, and tracking commitments.

Core principles:
- Be concise. Lead with the answer. Phone-readable.
- NEVER send anything to a third party (client, vendor, contact) without an explicit approval from the user. When asked to handle a client communication, draft it and present it for review.
- When the user gives you information worth keeping, use the remember tool.
- If user intent is unclear, ask one focused clarifying question.
- Speak naturally, like a trusted assistant. No filler ("Happy to help!", "Let me know if you need anything else!").`;

const MAX_HISTORY = 30;
const MAX_TOOL_HOPS = 8;

function buildSystemPrompt(override: string | null): string {
  const base = override?.trim() ? override : DEFAULT_SYSTEM_PROMPT;
  return `${base}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`;
}

export interface RespondArgs {
  tenantId: string;
  userId: string;
  userText: string;
  channel?: string;
}

export async function respond(args: RespondArgs): Promise<string> {
  const { tenantId, userId, userText, channel = "telegram" } = args;

  await prisma.message.create({
    data: { tenantId, role: MessageRole.user, content: userText, channel },
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { systemPromptOverride: true },
  });
  const systemPrompt = buildSystemPrompt(tenant.systemPromptOverride);

  const history = await prisma.message.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });
  const messages: Anthropic.MessageParam[] = history
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));

  let finalText = "";
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const response = await client.messages.create({
      model: process.env.ARI_MODEL ?? "claude-sonnet-5-5",
      // Thinking is always on and cannot be disabled on Opus 5.5, and its
      // tokens count against max_tokens. 1024 was sized for a model that ran
      // without thinking and would truncate before any text block.
      max_tokens: 4096,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      tools: toolDefinitions,
      messages,
    });

    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    totalCacheRead += response.usage.cache_read_input_tokens ?? 0;
    totalCacheWrite += response.usage.cache_creation_input_tokens ?? 0;

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (response.stop_reason === "tool_use" && toolUses.length > 0) {
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const tool = tools[use.name];
        let result: string;
        try {
          result = tool
            ? await tool.execute(use.input, { tenantId, userId })
            : `Unknown tool: ${use.name}`;
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    finalText = textParts.join("\n").trim();
    break;
  }

  if (!finalText) finalText = "(no response)";

  await prisma.message.create({
    data: {
      tenantId,
      role: MessageRole.assistant,
      content: finalText,
      channel,
    },
  });

  await recordUsage({
    tenantId,
    model: process.env.ARI_MODEL ?? "claude-sonnet-5-5",
    inputTokens: totalIn,
    outputTokens: totalOut,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
  });

  return finalText;
}

interface UsageArgs {
  tenantId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

async function recordUsage(args: UsageArgs): Promise<void> {
  const cost = estimateCost(args);
  await prisma.apiUsage.create({
    data: { ...args, costUsd: cost },
  });
}

function estimateCost({
  model,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
}: UsageArgs): number {
  // Rough per-million-token pricing (USD). Update as published rates change.
  const pricing: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
    "claude-opus-5-5":    { in: 4,    out: 20,  cacheRead: 0.20, cacheWrite: 5 },
    "claude-sonnet-5-5":  { in: 2,    out: 10,  cacheRead: 0.10, cacheWrite: 2.50 },
    // Haiku 5.5 is priced by prompt size; this is the up-to-100k tier.
    "claude-haiku-5-5":   { in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
    "claude-sonnet-4-6":  { in: 3,    out: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
    "claude-opus-4-7":    { in: 5,    out: 25,  cacheRead: 0.50, cacheWrite: 6.25 },
    "claude-haiku-4-5":   { in: 1,    out: 5,   cacheRead: 0.10, cacheWrite: 1.25 },
    "claude-haiku-4-5-20251001": { in: 1, out: 5, cacheRead: 0.10, cacheWrite: 1.25 },
  };
  const p = pricing[model] ?? pricing["claude-sonnet-5-5"]!;
  return (
    (inputTokens * p.in +
      outputTokens * p.out +
      cacheReadTokens * p.cacheRead +
      cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
