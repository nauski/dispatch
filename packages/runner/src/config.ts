import { hostname } from "os";
import { readFileSync, existsSync } from "fs";

export interface RunnerRoleConfig {
  workDir?: string;  // CWD for Claude sessions (optional, defaults to tmpdir)
}

export interface RunnerConfig {
  serverUrl: string;
  machineName: string;
  roles: string[] | Record<string, RunnerRoleConfig>;
  maxConcurrent: number;
  claudePath: string;
  dispatchMcpPath: string;
  auth: {
    key?: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
  };
}

/** Get role names as a flat list */
export function getRoleNames(cfg: RunnerConfig): string[] {
  if (Array.isArray(cfg.roles)) return cfg.roles;
  return Object.keys(cfg.roles);
}

/** Get workDir for a role (if configured) */
export function getRoleWorkDir(cfg: RunnerConfig, role: string): string | undefined {
  if (Array.isArray(cfg.roles)) return undefined;
  return cfg.roles[role]?.workDir;
}

function loadConfig(): RunnerConfig {
  const configPath = process.env.RUNNER_CONFIG || "./runner.json";

  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      serverUrl: raw.serverUrl || process.env.DISPATCH_SERVER_URL || "ws://localhost:3000",
      machineName: raw.machineName || process.env.DISPATCH_MACHINE_NAME || hostname(),
      roles: raw.roles || [],
      maxConcurrent: raw.maxConcurrent ?? parseInt(process.env.DISPATCH_MAX_CONCURRENT || "4"),
      claudePath: raw.claudePath || process.env.CLAUDE_PATH || "claude",
      dispatchMcpPath: raw.dispatchMcpPath || process.env.DISPATCH_MCP_PATH || "dispatch-mcp",
      auth: {
        key: raw.auth?.key || process.env.DISPATCH_AUTH_KEY || "",
        tokenEndpoint: raw.auth?.tokenEndpoint || process.env.DISPATCH_TOKEN_ENDPOINT || "",
        clientId: raw.auth?.clientId || process.env.DISPATCH_CLIENT_ID || "dispatch-daemon",
        clientSecret: raw.auth?.clientSecret || process.env.DISPATCH_CLIENT_SECRET || "",
      },
    };
  }

  const rolesEnv = process.env.DISPATCH_ROLES || "";
  const roles = rolesEnv.split(",").filter(Boolean);

  return {
    serverUrl: process.env.DISPATCH_SERVER_URL || "ws://localhost:3000",
    machineName: process.env.DISPATCH_MACHINE_NAME || hostname(),
    roles,
    maxConcurrent: parseInt(process.env.DISPATCH_MAX_CONCURRENT || "4"),
    claudePath: process.env.CLAUDE_PATH || "claude",
    dispatchMcpPath: process.env.DISPATCH_MCP_PATH || "dispatch-mcp",
    auth: {
      key: process.env.DISPATCH_AUTH_KEY || "",
      tokenEndpoint: process.env.DISPATCH_TOKEN_ENDPOINT || "",
      clientId: process.env.DISPATCH_CLIENT_ID || "dispatch-daemon",
      clientSecret: process.env.DISPATCH_CLIENT_SECRET || "",
    },
  };
}

export const config = loadConfig();
