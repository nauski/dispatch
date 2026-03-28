import { spawn } from "child_process";
import { config, type RoleConfig } from "../config.js";
import type { Provider, ProviderRunOptions } from "./types.js";

const DISPATCH_MCP_TOOLS = [
  "mcp__dispatch__post_task_comment",
  "mcp__dispatch__get_task_comments",
  "mcp__dispatch__update_task",
];

export class ClaudeCliProvider implements Provider {
  constructor(private roleConfig: RoleConfig) {}

  run(options: ProviderRunOptions): Promise<{ output: string }> {
    return new Promise((resolve, reject) => {
      const tools = [
        ...(this.roleConfig.allowedTools || ["Read", "Glob", "Grep", "Edit", "Write"]),
        ...DISPATCH_MCP_TOOLS,
      ];
      const args = [
        "-p", options.prompt,
        "--output-format", "text",
        "--allowedTools", tools.join(","),
      ];

      if (options.mcpConfigPath) {
        args.push("--mcp-config", options.mcpConfigPath);
      }

      const proc = spawn(config.claudePath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.workDir,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({ output: stdout.trim() });
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
