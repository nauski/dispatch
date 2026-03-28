import { execSync } from "child_process";
import type { Tool } from "./types.js";

const DEFAULT_TIMEOUT = 120_000;
const MAX_OUTPUT = 100_000;

export const bashTool: Tool = {
  definition: {
    name: "Bash",
    description: "Execute a shell command. Runs in the task's working directory with a timeout.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default 120000, max 600000)",
        },
      },
      required: ["command"],
    },
  },

  async execute(params, workDir) {
    const command = params.command as string;
    const timeout = Math.min((params.timeout as number) || DEFAULT_TIMEOUT, 600_000);

    try {
      const result = execSync(command, {
        cwd: workDir,
        encoding: "utf-8",
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });

      const output = result.length > MAX_OUTPUT
        ? result.slice(0, MAX_OUTPUT) + `\n\n... (output truncated at ${MAX_OUTPUT} chars)`
        : result;
      return { output: output || "(no output)" };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string; status?: number };
      const stderr = error.stderr || "";
      const stdout = error.stdout || "";
      return {
        output: `Command exited with code ${error.status || "unknown"}\nstdout: ${stdout}\nstderr: ${stderr}`,
        error: true,
      };
    }
  },
};
