import { readFileSync } from "fs";
import { resolveSafePath } from "./safepath.js";
import type { Tool } from "./types.js";

const MAX_LINES = 2000;

export const readTool: Tool = {
  definition: {
    name: "Read",
    description: "Read a file from the filesystem. Returns content with line numbers.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to read",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read",
        },
      },
      required: ["file_path"],
    },
  },

  async execute(params, workDir) {
    const filePath = resolveSafePath(params.file_path as string, workDir);
    const offset = (params.offset as number) || 1;
    const limit = (params.limit as number) || MAX_LINES;

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const startIdx = Math.max(0, offset - 1);
      const endIdx = Math.min(lines.length, startIdx + limit);
      const selected = lines.slice(startIdx, endIdx);

      const numbered = selected
        .map((line, i) => `${startIdx + i + 1}\t${line}`)
        .join("\n");

      const totalLines = lines.length;
      let result = numbered;
      if (endIdx < totalLines) {
        result += `\n\n... (${totalLines - endIdx} more lines, ${totalLines} total)`;
      }
      return { output: result };
    } catch (err) {
      return { output: `Error reading file: ${(err as Error).message}`, error: true };
    }
  },
};
