import { readFileSync, writeFileSync } from "fs";
import { resolveSafePath } from "./safepath.js";
import type { Tool } from "./types.js";

export const editTool: Tool = {
  definition: {
    name: "Edit",
    description: "Perform exact string replacement in a file. The old_string must appear exactly once in the file (unless replace_all is true).",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact text to find and replace",
        },
        new_string: {
          type: "string",
          description: "The replacement text",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default false)",
          default: false,
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },

  async execute(params, workDir) {
    const filePath = resolveSafePath(params.file_path as string, workDir);
    const oldString = params.old_string as string;
    const newString = params.new_string as string;
    const replaceAll = (params.replace_all as boolean) || false;

    try {
      const content = readFileSync(filePath, "utf-8");

      if (!content.includes(oldString)) {
        return { output: `Error: old_string not found in ${filePath}`, error: true };
      }

      if (!replaceAll) {
        const firstIdx = content.indexOf(oldString);
        const lastIdx = content.lastIndexOf(oldString);
        if (firstIdx !== lastIdx) {
          return {
            output: `Error: old_string appears multiple times in ${filePath}. Use replace_all or provide more context to make it unique.`,
            error: true,
          };
        }
      }

      const updated = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      writeFileSync(filePath, updated, "utf-8");
      return { output: `Successfully edited ${filePath}` };
    } catch (err) {
      return { output: `Error editing file: ${(err as Error).message}`, error: true };
    }
  },
};
