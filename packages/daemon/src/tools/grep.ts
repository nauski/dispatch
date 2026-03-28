import { execSync } from "child_process";
import { resolveSafePath } from "./safepath.js";
import type { Tool } from "./types.js";

const MAX_MATCHES = 200;

export const grepTool: Tool = {
  definition: {
    name: "Grep",
    description: "Search file contents using regex patterns. Uses ripgrep if available, falls back to grep.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description: "File or directory to search in. Defaults to working directory.",
        },
        glob: {
          type: "string",
          description: "Glob pattern to filter files (e.g. '*.ts')",
        },
        case_insensitive: {
          type: "boolean",
          description: "Case insensitive search",
        },
      },
      required: ["pattern"],
    },
  },

  async execute(params, workDir) {
    const pattern = params.pattern as string;
    const searchPath = params.path
      ? resolveSafePath(params.path as string, workDir)
      : workDir;
    const glob = params.glob as string | undefined;
    const ignoreCase = (params.case_insensitive as boolean) || false;

    try {
      const args: string[] = [];

      // Try ripgrep first, fall back to grep
      let cmd: string;
      try {
        execSync("which rg", { stdio: "ignore" });
        cmd = "rg";
        args.push("--no-heading", "--line-number", `-M${MAX_MATCHES}`);
        if (ignoreCase) args.push("-i");
        if (glob) args.push("--glob", glob);
        args.push("--", pattern, searchPath);
      } catch {
        cmd = "grep";
        args.push("-rn");
        if (ignoreCase) args.push("-i");
        if (glob) args.push("--include", glob);
        args.push("--", pattern, searchPath);
      }

      const result = execSync(`${cmd} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
        cwd: workDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });

      const lines = result.trim().split("\n");
      if (lines.length > MAX_MATCHES) {
        return {
          output: lines.slice(0, MAX_MATCHES).join("\n") +
            `\n\n... (${lines.length - MAX_MATCHES} more matches, ${lines.length} total)`,
        };
      }
      return { output: result.trim() || "No matches found." };
    } catch (err) {
      const error = err as { status?: number; stdout?: string; message?: string };
      // grep returns exit code 1 for no matches
      if (error.status === 1) {
        return { output: "No matches found." };
      }
      return { output: `Error: ${error.message || "grep failed"}`, error: true };
    }
  },
};
