import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { resolveSafePath } from "./safepath.js";
import type { Tool } from "./types.js";

const MAX_RESULTS = 500;

export const globTool: Tool = {
  definition: {
    name: "Glob",
    description: "Find files matching a glob pattern. Returns matching file paths relative to the search directory.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match (e.g. '**/*.ts', 'src/**/*.js')",
        },
        path: {
          type: "string",
          description: "Directory to search in. Defaults to working directory.",
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

    try {
      const matches = matchGlob(searchPath, pattern, workDir);
      if (matches.length === 0) {
        return { output: "No files matched the pattern." };
      }
      const truncated = matches.slice(0, MAX_RESULTS);
      let result = truncated.join("\n");
      if (matches.length > MAX_RESULTS) {
        result += `\n\n... (${matches.length - MAX_RESULTS} more matches, ${matches.length} total)`;
      }
      return { output: result };
    } catch (err) {
      return { output: `Error: ${(err as Error).message}`, error: true };
    }
  },
};

function matchGlob(dir: string, pattern: string, workDir: string): string[] {
  const regex = globToRegex(pattern);
  const results: string[] = [];

  function walk(currentDir: string) {
    if (results.length >= MAX_RESULTS * 2) return;
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(currentDir, entry.name);
      const relPath = relative(workDir, fullPath);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (regex.test(relPath)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function globToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "(.+/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${regex}$`);
}
