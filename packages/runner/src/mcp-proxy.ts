#!/usr/bin/env node
/**
 * MCP proxy server — spawned by Claude CLI as an MCP server.
 * Proxies tool calls (Read, Write, Edit, Glob, Grep, Bash) to a remote
 * executor daemon via the dispatch server's WebSocket relay.
 *
 * Environment variables (set by the runner before spawning Claude):
 *   DISPATCH_WS_URL   — WebSocket URL of the dispatch server
 *   DISPATCH_TOKEN    — pre-fetched auth token
 *   TARGET_ROLE       — which role's executor to target
 *   PROXY_MACHINE     — machine name to register with (default: proxy-<pid>)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { randomUUID } from "crypto";

const WS_URL = process.env.DISPATCH_WS_URL;
const TOKEN = process.env.DISPATCH_TOKEN;
const TARGET_ROLE = process.env.TARGET_ROLE;
const MACHINE = process.env.PROXY_MACHINE || `proxy-${process.pid}`;

if (!WS_URL || !TOKEN || !TARGET_ROLE) {
  console.error("mcp-proxy: DISPATCH_WS_URL, DISPATCH_TOKEN, and TARGET_ROLE are required");
  process.exit(1);
}

// --- WebSocket connection to the dispatch server ---

type PendingRequest = {
  resolve: (value: { output: string; error: boolean }) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingRequest>();
let ws: WebSocket | null = null;
let wsReady: Promise<void>;
let resolveWsReady: () => void;

function resetWsReady() {
  wsReady = new Promise((resolve) => { resolveWsReady = resolve; });
}
resetWsReady();

function connectWs() {
  const params = new URLSearchParams({
    token: TOKEN!,
    machine: MACHINE,
    roles: "",
    type: "runner",
  });

  ws = new WebSocket(`${WS_URL}/ws/daemon?${params}`);

  ws.on("open", () => {
    console.error(`[mcp-proxy] Connected to ${WS_URL} as ${MACHINE}, targeting role: ${TARGET_ROLE}`);
    resolveWsReady();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "tool:result" && msg.requestId) {
        console.error(`[mcp-proxy] Received tool:result (${msg.requestId.slice(0,8)}) error=${msg.error}`);
        const req = pending.get(msg.requestId);
        if (req) {
          clearTimeout(req.timer);
          pending.delete(msg.requestId);
          req.resolve({ output: msg.output ?? "", error: msg.error ?? false });
        }
      }
    } catch {
      // ignore unparseable messages
    }
  });

  ws.on("close", (code, reason) => {
    console.error(`[mcp-proxy] WS closed: ${code} ${reason}`);
    resetWsReady();
    setTimeout(connectWs, 2000);
  });

  ws.on("error", (err) => {
    console.error(`[mcp-proxy] WS error: ${err.message}`);
  });
}

connectWs();

const TOOL_TIMEOUT_MS = 120_000; // 2 minutes, matching server relay timeout

async function executeRemoteTool(tool: string, params: Record<string, unknown>): Promise<string> {
  await wsReady;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket not connected to dispatch server");
  }

  const requestId = randomUUID();

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Tool ${tool} timed out after ${TOOL_TIMEOUT_MS}ms`));
    }, TOOL_TIMEOUT_MS);

    pending.set(requestId, {
      resolve: (result) => {
        if (result.error) {
          reject(new Error(result.output));
        } else {
          resolve(result.output);
        }
      },
      reject,
      timer,
    });

    const msg = {
      type: "tool:execute",
      requestId,
      targetRole: TARGET_ROLE,
      tool,
      params,
    };
    console.error(`[mcp-proxy] Sending tool:execute ${tool} (${requestId.slice(0,8)})`);
    ws!.send(JSON.stringify(msg));
  });
}

// --- MCP server ---

const server = new McpServer({
  name: "remote-tools",
  version: "0.1.0",
});

// Read
server.tool(
  "Read",
  "Read a file from the remote executor's filesystem",
  {
    file_path: z.string().describe("Absolute path to the file"),
    offset: z.number().optional().describe("Line number to start reading from"),
    limit: z.number().optional().describe("Number of lines to read"),
  },
  async (params) => {
    const output = await executeRemoteTool("Read", params);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

// Write
server.tool(
  "Write",
  "Write content to a file on the remote executor's filesystem",
  {
    file_path: z.string().describe("Absolute path to the file"),
    content: z.string().describe("Content to write"),
  },
  async (params) => {
    const output = await executeRemoteTool("Write", params);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

// Edit
server.tool(
  "Edit",
  "Edit a file on the remote executor's filesystem using string replacement",
  {
    file_path: z.string().describe("Absolute path to the file"),
    old_string: z.string().describe("Text to replace"),
    new_string: z.string().describe("Replacement text"),
    replace_all: z.boolean().optional().describe("Replace all occurrences"),
  },
  async (params) => {
    const output = await executeRemoteTool("Edit", params);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

// Glob
server.tool(
  "Glob",
  "Find files matching a glob pattern on the remote executor",
  {
    pattern: z.string().describe("Glob pattern to match"),
    path: z.string().optional().describe("Directory to search in"),
  },
  async (params) => {
    const output = await executeRemoteTool("Glob", params);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

// Grep
server.tool(
  "Grep",
  "Search file contents using regex on the remote executor",
  {
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("File or directory to search in"),
    glob: z.string().optional().describe("Glob pattern to filter files"),
    case_insensitive: z.boolean().optional().describe("Case insensitive search"),
  },
  async (params) => {
    const output = await executeRemoteTool("Grep", params);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

// Bash
server.tool(
  "Bash",
  "Execute a bash command on the remote executor",
  {
    command: z.string().describe("The command to execute"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  },
  async (params) => {
    const output = await executeRemoteTool("Bash", params);
    return { content: [{ type: "text" as const, text: output }] };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("mcp-proxy fatal:", err);
  process.exit(1);
});
