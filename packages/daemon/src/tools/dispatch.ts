import type { Tool } from "./types.js";

/**
 * Creates dispatch API tools that call the server REST API directly.
 * Used by API providers (OpenAI, etc.) instead of MCP.
 */
export function createDispatchTools(baseUrl: string): Tool[] {
  return [postTaskComment(baseUrl), getTaskComments(baseUrl), updateTask(baseUrl)];
}

function postTaskComment(baseUrl: string): Tool {
  return {
    definition: {
      name: "post_task_comment",
      description: "Post a comment on a task. Use this to ask questions, report status, or request clarification.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The task ID" },
          body: { type: "string", description: "The comment text" },
          author: { type: "string", description: "Author name (default: 'agent')" },
        },
        required: ["taskId", "body"],
      },
    },

    async execute(params) {
      const taskId = params.taskId as string;
      const body = params.body as string;
      const author = (params.author as string) || "agent";

      try {
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, author }),
        });
        if (!res.ok) {
          return { output: `Error posting comment: ${res.status} ${await res.text()}`, error: true };
        }
        return { output: "Comment posted successfully." };
      } catch (err) {
        return { output: `Error: ${(err as Error).message}`, error: true };
      }
    },
  };
}

function getTaskComments(baseUrl: string): Tool {
  return {
    definition: {
      name: "get_task_comments",
      description: "Get all comments on a task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The task ID" },
        },
        required: ["taskId"],
      },
    },

    async execute(params) {
      const taskId = params.taskId as string;

      try {
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}/comments`);
        if (!res.ok) {
          return { output: `Error fetching comments: ${res.status} ${await res.text()}`, error: true };
        }
        const comments = await res.json();
        return { output: JSON.stringify(comments, null, 2) };
      } catch (err) {
        return { output: `Error: ${(err as Error).message}`, error: true };
      }
    },
  };
}

function updateTask(baseUrl: string): Tool {
  return {
    definition: {
      name: "update_task",
      description: "Update a task's status or fields. Use to set status to 'needs_info' when you need clarification.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The task ID" },
          status: { type: "string", description: "New status (e.g. 'needs_info', 'done', 'assigned')" },
          result: { type: "string", description: "Result description" },
        },
        required: ["taskId"],
      },
    },

    async execute(params) {
      const taskId = params.taskId as string;
      const body: Record<string, unknown> = {};
      if (params.status) body.status = params.status;
      if (params.result) body.result = params.result;

      try {
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          return { output: `Error updating task: ${res.status} ${await res.text()}`, error: true };
        }
        return { output: "Task updated successfully." };
      } catch (err) {
        return { output: `Error: ${(err as Error).message}`, error: true };
      }
    },
  };
}
