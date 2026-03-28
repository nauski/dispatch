import type { Tool } from "./types.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { bashTool } from "./bash.js";
import { createDispatchTools } from "./dispatch.js";

const builtinTools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
];

const builtinByName = new Map(builtinTools.map(t => [t.definition.name, t]));

/**
 * Resolve a set of tool names to Tool implementations.
 * Includes both builtin tools (Read, Write, etc.) and dispatch API tools.
 */
export function resolveTools(
  allowedNames: string[],
  dispatchBaseUrl: string,
): Tool[] {
  const dispatchTools = createDispatchTools(dispatchBaseUrl);
  const dispatchByName = new Map(dispatchTools.map(t => [t.definition.name, t]));

  const tools: Tool[] = [];

  for (const name of allowedNames) {
    const tool = builtinByName.get(name) || dispatchByName.get(name);
    if (tool) {
      tools.push(tool);
    }
  }

  // Always include dispatch tools
  for (const tool of dispatchTools) {
    if (!tools.some(t => t.definition.name === tool.definition.name)) {
      tools.push(tool);
    }
  }

  return tools;
}

/**
 * Get a single builtin tool by name (Read, Write, Edit, Glob, Grep, Bash).
 * Returns undefined if not found.
 */
export function getBuiltinTool(name: string): Tool | undefined {
  return builtinByName.get(name);
}

export type { Tool, ToolDefinition, ToolResult } from "./types.js";
