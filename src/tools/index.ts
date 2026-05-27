import type { ToolRegistry } from "./types.js";
import { rememberTool } from "./remember.js";

export const tools: ToolRegistry = {
  [rememberTool.definition.name]: rememberTool,
};

export const toolDefinitions = Object.values(tools).map((t) => t.definition);
