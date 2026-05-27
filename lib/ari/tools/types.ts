import type Anthropic from "@anthropic-ai/sdk";

export interface ToolContext {
  tenantId: string;
  userId: string;
}

export interface Tool {
  definition: Anthropic.Tool;
  execute: (input: unknown, ctx: ToolContext) => Promise<string>;
}

export type ToolRegistry = Record<string, Tool>;
