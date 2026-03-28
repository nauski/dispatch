import { hostname } from "os";
import { readFileSync, existsSync } from "fs";

export const DEFAULT_ALLOWED_TOOLS = [
  "Read", "Glob", "Grep",  // read-only, always safe
  "Edit", "Write",          // file modifications (the point of most tasks)
];

export type ProviderType = "claude-cli" | "openai" | "openrouter" | "mistral";

export interface RoleConfig {
  workDir: string;
  claudeMd?: string;
  allowedTools?: string[];   // override default tools, e.g. ["Read","Glob","Grep","Edit","Write","Bash"]
  provider?: ProviderType;   // default: "claude-cli"
  model?: string;            // e.g. "gpt-4o", "mistral-large-latest"
  apiKey?: string;           // per-role API key override
  baseUrl?: string;          // custom endpoint override
}

export type DaemonMode = "local" | "executor";

interface DaemonConfig {
  serverUrl: string;
  machineName: string;
  mode: DaemonMode;
  roles: Record<string, RoleConfig>;
  maxConcurrent: number;
  claudePath: string;
  dispatchMcpPath: string;
  auth: {
    key?: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
  };
  apiKeys?: {
    openai?: string;
    openrouter?: string;
    mistral?: string;
  };
}

const ENV_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

/**
 * Resolve the API key for a given provider and role.
 * Priority: role apiKey > daemon apiKeys.{provider} > env var
 */
export function resolveApiKey(
  provider: ProviderType,
  roleConfig: RoleConfig,
  daemonConfig: DaemonConfig,
): string {
  if (roleConfig.apiKey) return roleConfig.apiKey;
  const daemonKey = daemonConfig.apiKeys?.[provider as keyof NonNullable<DaemonConfig["apiKeys"]>];
  if (daemonKey) return daemonKey;
  const envVar = ENV_KEY_MAP[provider];
  if (envVar) return process.env[envVar] || "";
  return "";
}

function loadConfig(): DaemonConfig {
  const configPath = process.env.DISPATCH_CONFIG || "./dispatch-daemon.json";

  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      serverUrl: raw.serverUrl || process.env.DISPATCH_SERVER_URL || "ws://localhost:3000",
      machineName: raw.machineName || process.env.DISPATCH_MACHINE_NAME || hostname(),
      mode: (raw.mode || process.env.DISPATCH_MODE || "local") as DaemonMode,
      roles: raw.roles || {},
      maxConcurrent: raw.maxConcurrent ?? parseInt(process.env.DISPATCH_MAX_CONCURRENT || "4"),
      claudePath: raw.claudePath || process.env.CLAUDE_PATH || "claude",
      dispatchMcpPath: raw.dispatchMcpPath || process.env.DISPATCH_MCP_PATH || "dispatch-mcp",
      auth: {
        key: raw.auth?.key || process.env.DISPATCH_AUTH_KEY || "",
        tokenEndpoint: raw.auth?.tokenEndpoint || process.env.DISPATCH_TOKEN_ENDPOINT || "",
        clientId: raw.auth?.clientId || process.env.DISPATCH_CLIENT_ID || "dispatch-daemon",
        clientSecret: raw.auth?.clientSecret || raw.token || process.env.DISPATCH_CLIENT_SECRET || "",
      },
      apiKeys: raw.apiKeys || {},
    };
  }

  const roles: Record<string, RoleConfig> = {};
  const rolesEnv = process.env.DISPATCH_ROLES || "";
  for (const entry of rolesEnv.split(",").filter(Boolean)) {
    const [name, workDir] = entry.split(":");
    if (name && workDir) {
      roles[name] = { workDir };
    }
  }

  return {
    serverUrl: process.env.DISPATCH_SERVER_URL || "ws://localhost:3000",
    machineName: process.env.DISPATCH_MACHINE_NAME || hostname(),
    mode: (process.env.DISPATCH_MODE || "local") as DaemonMode,
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
    apiKeys: {},
  };
}

export const config = loadConfig();
