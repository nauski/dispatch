#!/usr/bin/env node
import WebSocket from "ws";
import { config, resolveApiKey, DEFAULT_ALLOWED_TOOLS, type RoleConfig } from "./config.js";
import { getToken } from "./auth.js";
import { ClaudeCliProvider } from "./providers/claude-cli.js";
import { OpenAICompatProvider } from "./providers/openai-compat.js";
import type { Provider } from "./providers/types.js";
import { buildPrompt, buildConversationalPrompt, type Task, type TaskComment } from "./prompts.js";
import { writeMcpConfig, cleanupMcpConfig } from "./mcp-config.js";
import { getBuiltinTool } from "./tools/index.js";

let activeSessions = 0;
let ws: WebSocket;

function createProvider(roleConfig: RoleConfig): Provider {
  const providerType = roleConfig.provider || "claude-cli";

  if (providerType === "claude-cli") {
    return new ClaudeCliProvider(roleConfig);
  }

  const apiKey = resolveApiKey(providerType, roleConfig, config);
  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${providerType}". ` +
      `Set it in role config (apiKey), daemon config (apiKeys.${providerType}), ` +
      `or environment variable.`
    );
  }

  return new OpenAICompatProvider({
    providerType: providerType as "openai" | "openrouter" | "mistral",
    apiKey,
    model: roleConfig.model,
    baseUrl: roleConfig.baseUrl,
  });
}

function getDispatchBaseUrl(): string {
  return config.serverUrl.replace(/^ws/, "http");
}

async function connect() {
  const roleNames = Object.keys(config.roles);

  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to get token: ${msg}. Retrying in 10s...`);
    setTimeout(connect, 10_000);
    return;
  }

  const params = new URLSearchParams({
    token,
    machine: config.machineName,
    roles: roleNames.join(","),
    type: config.mode === "executor" ? "executor" : "daemon",
  });

  ws = new WebSocket(`${config.serverUrl}/ws/daemon?${params}`);

  ws.on("open", () => {
    console.log(`Connected to ${config.serverUrl} as ${config.machineName}`);
    console.log(`Serving roles: ${roleNames.map(r => {
      const rc = config.roles[r];
      const provider = rc.provider || "claude-cli";
      return `${r} (${rc.workDir}, ${provider}${rc.model ? `:${rc.model}` : ""})`;
    }).join(", ")}`);
    if (config.mode === "local") {
      console.log(`Max concurrent sessions: ${config.maxConcurrent}`);
    }
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (config.mode === "executor") {
        if (msg.type === "tool:execute") {
          handleToolExecute(msg, ws);
        }
      } else {
        if (msg.type === "task:assigned") {
          const task = { ...msg.task, executionId: msg.executionId || null };
          handleTask(task, msg.context);
        } else if (msg.type === "task:comment_notification") {
          handleCommentNotification(msg.task, msg.comment, msg.comments);
        }
      }
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  });

  let reconnecting = false;
  const scheduleReconnect = (delay: number) => {
    if (reconnecting) return;
    reconnecting = true;
    setTimeout(connect, delay);
  };

  ws.on("close", (code, reason) => {
    console.log(`Disconnected (${code}: ${reason}). Reconnecting in 5s...`);
    scheduleReconnect(5000);
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error: ${err.message}. Reconnecting in 5s...`);
    scheduleReconnect(5000);
  });
}

async function handleTask(task: Task, context?: { comments: TaskComment[] }) {
  if (activeSessions >= config.maxConcurrent) {
    console.log(`At capacity (${activeSessions}/${config.maxConcurrent}), deferring task ${task.id}`);
    return;
  }

  const role = task.toRole;
  if (!role || !config.roles[role]) {
    console.error(`No config for role "${role}", skipping task ${task.id}`);
    return;
  }

  const roleConfig = config.roles[role];
  const workDir = task.workDir || roleConfig.workDir;
  const providerType = roleConfig.provider || "claude-cli";

  activeSessions++;
  console.log(`[${role}] Starting task ${task.id}: ${task.title} (cwd: ${workDir}, provider: ${providerType})${task.executionId ? ` [execution: ${task.executionId}]` : ""}`);

  sendStatus(task.id, "in_progress", undefined, task.executionId);

  const prompt = buildPrompt(task, context);
  const isCliProvider = providerType === "claude-cli";
  const mcpConfigPath = isCliProvider ? writeMcpConfig(task.id, getDispatchBaseUrl()) : undefined;

  try {
    const provider = createProvider(roleConfig);
    const result = await provider.run({
      prompt,
      workDir,
      allowedTools: roleConfig.allowedTools || DEFAULT_ALLOWED_TOOLS,
      mcpConfigPath,
      dispatchBaseUrl: getDispatchBaseUrl(),
      taskId: task.id,
    });
    sendStatus(task.id, "done", result.output, task.executionId);
    console.log(`[${role}] Completed task ${task.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If the agent set needs_info via MCP, don't overwrite with "failed"
    if (!message.includes("needs_info")) {
      sendStatus(task.id, "failed", message, task.executionId);
    }
    console.error(`[${role}] Failed task ${task.id}:`, message);
  } finally {
    activeSessions--;
    if (mcpConfigPath) cleanupMcpConfig(mcpConfigPath);
  }
}

async function handleCommentNotification(task: Task, comment: TaskComment, comments: TaskComment[]) {
  if (activeSessions >= config.maxConcurrent) {
    console.log(`At capacity (${activeSessions}/${config.maxConcurrent}), deferring comment on task ${task.id}`);
    return;
  }

  const role = task.toRole;
  if (!role || !config.roles[role]) {
    console.error(`No config for role "${role}", skipping comment notification for task ${task.id}`);
    return;
  }

  const roleConfig = config.roles[role];
  const workDir = task.workDir || roleConfig.workDir;
  const providerType = roleConfig.provider || "claude-cli";
  const isCliProvider = providerType === "claude-cli";

  activeSessions++;
  console.log(`[${role}] Handling comment on task ${task.id}: "${comment.body.slice(0, 80)}"`);

  const prompt = buildConversationalPrompt(task, comment, comments);
  const mcpConfigPath = isCliProvider ? writeMcpConfig(task.id, getDispatchBaseUrl()) : undefined;

  try {
    const provider = createProvider(roleConfig);
    await provider.run({
      prompt,
      workDir,
      allowedTools: roleConfig.allowedTools || DEFAULT_ALLOWED_TOOLS,
      mcpConfigPath,
      dispatchBaseUrl: getDispatchBaseUrl(),
      taskId: task.id,
    });
    console.log(`[${role}] Replied to comment on task ${task.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${role}] Failed to reply to comment on task ${task.id}:`, message);
  } finally {
    activeSessions--;
    if (mcpConfigPath) cleanupMcpConfig(mcpConfigPath);
  }
}

interface ToolExecuteMessage {
  type: "tool:execute";
  requestId: string;
  targetRole: string;
  tool: string;
  params: Record<string, unknown>;
}

async function handleToolExecute(msg: ToolExecuteMessage, socket: WebSocket) {
  const { requestId, targetRole, tool: toolName, params } = msg;

  const sendResult = (output: string, error: boolean) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "tool:result", requestId, output, error }));
    }
  };

  // Resolve role config
  const roleConfig = config.roles[targetRole];
  if (!roleConfig) {
    sendResult(`Role "${targetRole}" not found in daemon config`, true);
    return;
  }

  // Check tool is allowed for this role
  const allowedTools = roleConfig.allowedTools || DEFAULT_ALLOWED_TOOLS;
  if (!allowedTools.includes(toolName)) {
    sendResult(`Tool "${toolName}" is not allowed for role "${targetRole}"`, true);
    return;
  }

  // Get builtin tool implementation
  const tool = getBuiltinTool(toolName);
  if (!tool) {
    sendResult(`Tool "${toolName}" not found`, true);
    return;
  }

  try {
    const result = await tool.execute(params, roleConfig.workDir);
    sendResult(result.output, result.error ?? false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendResult(message, true);
  }
}

function sendStatus(taskId: string, status: string, result?: string, executionId?: string | null) {
  if (ws.readyState === WebSocket.OPEN) {
    const msg: Record<string, unknown> = { type: "task:status", taskId, status, result };
    if (executionId) msg.executionId = executionId;
    ws.send(JSON.stringify(msg));
  }
}

// Start
console.log(`Running in ${config.mode} mode`);
const roleNames = Object.keys(config.roles);

if (!config.auth.key && !config.auth.clientSecret) {
  console.error("Auth required. Set auth.key (shared key) or auth.clientSecret (Keycloak) in config.");
  process.exit(1);
}

if (roleNames.length === 0) {
  console.error("No roles configured. Use DISPATCH_ROLES or a dispatch-daemon.json config file.");
  console.error('  Env: DISPATCH_ROLES="infra:/path/to/infra,dev:/path/to/repo"');
  console.error('  File: { "roles": { "infra": { "workDir": "/path/to/infra" } } }');
  process.exit(1);
}

connect();
