#!/usr/bin/env node
import WebSocket from "ws";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { config, getRoleNames, getRoleWorkDir } from "./config.js";
import { getToken } from "./auth.js";
import { buildPrompt, buildConversationalPrompt, type Task, type TaskComment } from "./prompts.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let activeSessions = 0;
let ws: WebSocket;

// --- MCP config helpers ---

function getDispatchBaseUrl(): string {
  return config.serverUrl.replace(/^ws/, "http");
}

interface McpConfigOptions {
  taskId: string;
  token: string;
  targetRole: string;
}

function writeMcpConfig(opts: McpConfigOptions): string {
  const configPath = join(tmpdir(), `dispatch-runner-mcp-${opts.taskId}.json`);
  const mcpProxyPath = join(__dirname, "mcp-proxy.js");
  const mcpConfig = {
    mcpServers: {
      "remote-tools": {
        command: "node",
        args: [mcpProxyPath],
        env: {
          DISPATCH_WS_URL: config.serverUrl,
          DISPATCH_TOKEN: opts.token,
          TARGET_ROLE: opts.targetRole,
          PROXY_MACHINE: `proxy-${opts.taskId.slice(0, 8)}`,
          ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
        },
      },
      dispatch: {
        command: config.dispatchMcpPath,
        env: {
          DISPATCH_URL: getDispatchBaseUrl(),
          ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(mcpConfig));
  return configPath;
}

function cleanupMcpConfig(configPath: string) {
  try { unlinkSync(configPath); } catch { /* ignore */ }
}

// --- Tool allow-list for Claude CLI ---

const RUNNER_ALLOWED_TOOLS = [
  "mcp__remote-tools__Read",
  "mcp__remote-tools__Write",
  "mcp__remote-tools__Edit",
  "mcp__remote-tools__Glob",
  "mcp__remote-tools__Grep",
  "mcp__remote-tools__Bash",
  "mcp__dispatch__post_task_comment",
  "mcp__dispatch__update_task",
  "mcp__dispatch__get_task_comments",
];

// --- Claude CLI spawner ---

function spawnClaude(prompt: string, mcpConfigPath: string, workDir?: string): Promise<{ output: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "text",
      "--mcp-config", mcpConfigPath,
      "--allowedTools", RUNNER_ALLOWED_TOOLS.join(","),
    ];

    const proc = spawn(config.claudePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workDir || tmpdir(),
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ output: stdout.trim() || "(no output)" });
      } else {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

// --- Task handlers ---

async function handleTask(
  task: Task & { executionId?: string | null },
  context: { comments: TaskComment[] } | undefined,
  targetExecutor: string,
) {
  if (activeSessions >= config.maxConcurrent) {
    console.log(`At capacity (${activeSessions}/${config.maxConcurrent}), deferring task ${task.id}`);
    return;
  }

  activeSessions++;
  const role = task.toRole || "unknown";
  console.log(`[${role}] Starting task ${task.id}: ${task.title} (executor: ${targetExecutor})${task.executionId ? ` [execution: ${task.executionId}]` : ""}`);

  sendStatus(task.id, "in_progress", undefined, task.executionId);

  let mcpConfigPath: string | undefined;
  try {
    const token = await getToken();
    const prompt = buildPrompt(task, context);
    mcpConfigPath = writeMcpConfig({
      taskId: task.id,
      token,
      targetRole: role,
    });

    const roleWorkDir = getRoleWorkDir(config, role);
    const result = await spawnClaude(prompt, mcpConfigPath, roleWorkDir);
    sendStatus(task.id, "done", result.output, task.executionId);
    console.log(`[${role}] Completed task ${task.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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

  activeSessions++;
  const role = task.toRole || "unknown";
  console.log(`[${role}] Handling comment on task ${task.id}: "${comment.body.slice(0, 80)}"`);

  let mcpConfigPath: string | undefined;
  try {
    const token = await getToken();
    const prompt = buildConversationalPrompt(task, comment, comments);
    // For comment replies, target the same role as the task
    mcpConfigPath = writeMcpConfig({
      taskId: task.id,
      token,
      targetRole: role,
    });

    const roleWorkDir = getRoleWorkDir(config, role);
    await spawnClaude(prompt, mcpConfigPath, roleWorkDir);
    console.log(`[${role}] Replied to comment on task ${task.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${role}] Failed to reply to comment on task ${task.id}:`, message);
  } finally {
    activeSessions--;
    if (mcpConfigPath) cleanupMcpConfig(mcpConfigPath);
  }
}

// --- Status reporting ---

function sendStatus(taskId: string, status: string, result?: string, executionId?: string | null) {
  if (ws.readyState === WebSocket.OPEN) {
    const msg: Record<string, unknown> = { type: "task:status", taskId, status, result };
    if (executionId) msg.executionId = executionId;
    ws.send(JSON.stringify(msg));
  }
}

// --- WebSocket connection ---

async function connect() {
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
    roles: getRoleNames(config).join(","),
    type: "runner",
  });

  ws = new WebSocket(`${config.serverUrl}/ws/daemon?${params}`);

  ws.on("open", () => {
    console.log(`Connected to ${config.serverUrl} as ${config.machineName} (runner)`);
    console.log(`Serving roles: ${getRoleNames(config).join(", ")}`);
    console.log(`Max concurrent sessions: ${config.maxConcurrent}`);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "task:assigned") {
        const task = { ...msg.task, executionId: msg.executionId || null };
        handleTask(task, msg.context, msg.targetExecutor || task.toRole || "");
      } else if (msg.type === "task:comment_notification") {
        handleCommentNotification(msg.task, msg.comment, msg.comments);
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

// --- Start ---

console.log("Dispatch Runner starting...");
console.log(`MCP proxy path: ${join(__dirname, "mcp-proxy.js")} (exists: ${existsSync(join(__dirname, "mcp-proxy.js"))})`);

if (!config.auth.key && !config.auth.clientSecret) {
  console.error("Auth required. Set auth.key (shared key) or auth.clientSecret (Keycloak) in config.");
  process.exit(1);
}

if (getRoleNames(config).length === 0) {
  console.error("No roles configured. Set roles in runner.json or DISPATCH_ROLES env var.");
  console.error('  Env: DISPATCH_ROLES="infra,dev"');
  console.error('  File: { "roles": ["infra", "dev"] }');
  process.exit(1);
}

connect();
