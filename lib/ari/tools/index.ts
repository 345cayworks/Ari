import type { ToolRegistry } from "./types";
import { rememberTool } from "./remember";

export const tools: ToolRegistry = {
  [rememberTool.definition.name]: rememberTool,
};

export const toolDefinitions = Object.values(tools).map((t) => t.definition);
