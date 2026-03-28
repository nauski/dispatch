import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { config } from "./config.js";

export function writeMcpConfig(taskId: string, serverUrl: string): string {
  const configPath = join(tmpdir(), `dispatch-mcp-${taskId}.json`);
  const mcpConfig = {
    mcpServers: {
      dispatch: {
        command: config.dispatchMcpPath,
        env: { DISPATCH_URL: serverUrl },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(mcpConfig));
  return configPath;
}

export function cleanupMcpConfig(configPath: string) {
  try { unlinkSync(configPath); } catch {}
}
