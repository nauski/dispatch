#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DISPATCH_URL =
  process.env.DISPATCH_URL || "http://localhost:3000";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${DISPATCH_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dispatch API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

const server = new McpServer({
  name: "dispatch",
  version: "0.1.0",
});

// List roles
server.tool(
  "list_roles",
  "List all available agent roles on the Dispatch board",
  {},
  async () => {
    const roles = await api<unknown[]>("/api/roles");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(roles, null, 2),
        },
      ],
    };
  },
);

// List daemons
server.tool(
  "list_daemons",
  "List all connected daemons and their roles/status",
  {},
  async () => {
    const daemons = await api<unknown[]>("/api/daemons");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(daemons, null, 2),
        },
      ],
    };
  },
);

// List tasks
server.tool(
  "list_tasks",
  "List tasks on the Dispatch board, optionally filtered by status or role",
  {
    status: z
      .enum(["backlog", "assigned", "in_progress", "needs_info", "done", "failed"])
      .optional()
      .describe("Filter by task status"),
    role: z.string().optional().describe("Filter by assigned role"),
  },
  async ({ status, role }) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (role) params.set("role", role);
    const qs = params.toString();
    const tasks = await api<unknown[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  },
);

// Get task details
server.tool(
  "get_task",
  "Get full details of a task including history, dependencies, and attachments",
  {
    taskId: z.string().uuid().describe("The task ID"),
  },
  async ({ taskId }) => {
    const task = await api<Record<string, unknown>>(`/api/tasks/${taskId}`);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(task, null, 2),
        },
      ],
    };
  },
);

// Create task
server.tool(
  "create_task",
  "Create a new task on the Dispatch board. If a role is assigned and a daemon is connected for that role, the task will be immediately pushed to that daemon for execution. Use mode 'broadcast' to fan out the task to ALL connected daemons with the target role.",
  {
    title: z.string().describe("Short title describing the task"),
    description: z
      .string()
      .optional()
      .describe("Detailed description of what needs to be done"),
    toRole: z
      .string()
      .optional()
      .describe(
        "Role to assign this task to (e.g. 'infra', 'dev', 'dotfiles')",
      ),
    fromRole: z
      .string()
      .optional()
      .describe("Role of the agent creating this task"),
    priority: z
      .enum(["low", "normal", "high", "urgent"])
      .optional()
      .describe("Task priority"),
    requiresApproval: z
      .boolean()
      .optional()
      .describe(
        "If true, task needs human approval before a daemon will execute it",
      ),
    dependsOn: z
      .array(z.string().uuid())
      .optional()
      .describe("Task IDs that must complete before this task can start"),
    mode: z
      .enum(["single", "broadcast"])
      .optional()
      .describe("'single' (default) assigns to one daemon. 'broadcast' fans out to ALL daemons with the target role."),
    targets: z
      .array(z.string())
      .optional()
      .describe("For broadcast mode: only target these machine names (whitelist)"),
    excludeTargets: z
      .array(z.string())
      .optional()
      .describe("For broadcast mode: skip these machine names (blacklist)"),
  },
  async ({
    title,
    description,
    toRole,
    fromRole,
    priority,
    requiresApproval,
    dependsOn,
    mode,
    targets,
    excludeTargets,
  }) => {
    const task = await api<Record<string, unknown>>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        toRole,
        fromRole,
        priority,
        requiresApproval,
        dependsOn,
        mode,
        targets,
        excludeTargets,
      }),
    });
    const modeLabel = task.mode === "broadcast" ? " (broadcast)" : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `Task created: ${task.id}\nStatus: ${task.status}\nTitle: ${task.title}${task.toRole ? `\nAssigned to: ${task.toRole}${modeLabel}` : ""}`,
        },
      ],
    };
  },
);

// Update task
server.tool(
  "update_task",
  "Update a task's status, result, or other fields",
  {
    taskId: z.string().uuid().describe("The task ID to update"),
    status: z
      .enum(["backlog", "assigned", "in_progress", "needs_info", "done", "failed"])
      .optional()
      .describe("New status"),
    result: z.string().optional().describe("Result or output of the task"),
    title: z.string().optional().describe("Updated title"),
    description: z.string().optional().describe("Updated description"),
    toRole: z.string().optional().describe("Reassign to a different role"),
    priority: z
      .enum(["low", "normal", "high", "urgent"])
      .optional()
      .describe("Updated priority"),
    actor: z
      .string()
      .optional()
      .describe("Who is making this update (role name or 'web-ui')"),
  },
  async ({ taskId, ...updates }) => {
    const task = await api<Record<string, unknown>>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Task ${task.id} updated.\nStatus: ${task.status}${task.result ? `\nResult: ${task.result}` : ""}`,
        },
      ],
    };
  },
);

// Post a comment on a task
server.tool(
  "post_task_comment",
  "Post a comment on a task. Use this to ask questions, report unexpected state, or request clarification. If you need a response, also update the task status to needs_info.",
  {
    taskId: z.string().uuid().describe("The task ID to comment on"),
    body: z.string().describe("The comment text"),
    author: z
      .string()
      .optional()
      .describe("Who is posting (defaults to 'mcp')"),
  },
  async ({ taskId, body, author }) => {
    const comment = await api<Record<string, unknown>>(
      `/api/tasks/${taskId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ author: author || "mcp", body }),
      },
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Comment posted on task ${taskId} by ${comment.author}:\n${comment.body}`,
        },
      ],
    };
  },
);

// Get comments for a task
server.tool(
  "get_task_comments",
  "Get all comments on a task",
  {
    taskId: z.string().uuid().describe("The task ID"),
  },
  async ({ taskId }) => {
    const comments = await api<unknown[]>(`/api/tasks/${taskId}/comments`);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(comments, null, 2),
        },
      ],
    };
  },
);

// Wait for task completion (SSE-based, no polling)
server.tool(
  "wait_for_task",
  "Wait for a task to reach a terminal state (done, failed, or needs_info). Uses SSE for realtime push — does not poll. Call this after create_task to block until the delegated task completes.",
  {
    taskId: z.string().uuid().describe("The task ID to wait for"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default 300000 = 5 min, max 600000 = 10 min)"),
  },
  async ({ taskId, timeout }) => {
    const timeoutMs = Math.min(timeout || 300000, 600000);
    const url = `${DISPATCH_URL}/api/tasks/${taskId}/wait?timeout=${timeoutMs}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 5000);

    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Dispatch API error ${res.status}: ${text}`);
      }

      const body = res.body;
      if (!body) throw new Error("No response body");

      // Read SSE stream until we get a data line
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE: look for "data: " lines
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const task = JSON.parse(data);
              reader.cancel();
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Task ${task.id} completed.\nStatus: ${task.status}${task.result ? `\nResult: ${task.result}` : ""}`,
                  },
                ],
              };
            } catch {
              // Not valid JSON yet, continue
            }
          }
          if (line.startsWith("event: timeout")) {
            reader.cancel();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Timed out waiting for task ${taskId} after ${timeoutMs}ms. Task is still in progress.`,
                },
              ],
            };
          }
        }
        // Keep only the last incomplete line in the buffer
        buffer = lines[lines.length - 1];
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `SSE connection closed for task ${taskId} without receiving a result.`,
          },
        ],
      };
    } finally {
      clearTimeout(timer);
    }
  },
);

// Approve task
server.tool(
  "approve_task",
  "Approve a task that requires approval before execution",
  {
    taskId: z.string().uuid().describe("The task ID to approve"),
    approvedBy: z
      .string()
      .optional()
      .describe("Who is approving (defaults to 'mcp')"),
  },
  async ({ taskId, approvedBy }) => {
    const task = await api<Record<string, unknown>>(
      `/api/tasks/${taskId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ approvedBy: approvedBy || "mcp" }),
      },
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Task ${task.id} approved by ${task.approvedBy}. Status: ${task.status}`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
