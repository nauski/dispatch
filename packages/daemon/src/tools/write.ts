import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { resolveSafePath } from "./safepath.js";
import type { Tool } from "./types.js";

export const writeTool: Tool = {
  definition: {
    name: "Write",
    description: "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
  },

  async execute(params, workDir) {
    const filePath = resolveSafePath(params.file_path as string, workDir);
    const content = params.content as string;

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
      return { output: `Successfully wrote ${content.length} bytes to ${filePath}` };
    } catch (err) {
      return { output: `Error writing file: ${(err as Error).message}`, error: true };
    }
  },
};
