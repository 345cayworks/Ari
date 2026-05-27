import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { appendMessage, recentMessages } from "./memory.js";
import { tools, toolDefinitions } from "./tools/index.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Ari, a personal assistant${
  config.USER_NAME ? ` for ${config.USER_NAME}` : ""
}. Your job is to take work off the user's plate: triaging information, thinking through decisions, drafting communications, and tracking commitments.

Core principles:
- Be concise. Lead with the answer. Phone-readable.
- You will NEVER send anything to a third party (client, vendor, contact) without an explicit approval tap from the user. When asked to handle a client message, draft it and present it for review — do not act.
- When the user gives you information worth keeping, use the remember tool. Lean toward saving rather than forgetting.
- If user intent is unclear, ask one focused clarifying question.
- Speak naturally, like a trusted assistant — not a chatbot. No filler ("Happy to help!", "Let me know if you need anything else!").

Today is ${new Date().toISOString().slice(0, 10)}.`;

const MAX_HISTORY = 30;
const MAX_TOOL_HOPS = 8;

export async function respond(userId: number, userText: string): Promise<string> {
  appendMessage(userId, "user", userText);

  const history = recentMessages(userId, MAX_HISTORY);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalText = "";

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
    const response = await client.messages.create({
      model: config.ARI_MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: toolDefinitions,
      messages,
    });

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
            ? await tool.execute(use.input, { userId })
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

  if (!finalText) {
    finalText = "(no response)";
  }

  appendMessage(userId, "assistant", finalText);
  return finalText;
}
