import type { Task, Role, Daemon, Comment, TaskExecution, ApiKey } from "../types.ts";

const BASE = "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  tasks: {
    list: (params?: { status?: string; role?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => request<Task & { history: any[]; dependencies: any[]; attachments: any[]; comments: Comment[]; executions: TaskExecution[] }>(`/api/tasks/${id}`),
    create: (body: Partial<Task> & { title: string; dependsOn?: string[] }) =>
      request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Task> & { actor?: string }) =>
      request<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    approve: (id: string, approvedBy: string) =>
      request<Task>(`/api/tasks/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy }) }),
    comments: (id: string) => request<Comment[]>(`/api/tasks/${id}/comments`),
    addComment: (id: string, body: { author: string; body: string }) =>
      request<Comment>(`/api/tasks/${id}/comments`, { method: "POST", body: JSON.stringify(body) }),
  },
  roles: {
    list: () => request<Role[]>("/api/roles"),
    create: (body: { name: string; description?: string; allowedActions?: string[] }) =>
      request<Role>("/api/roles", { method: "POST", body: JSON.stringify(body) }),
  },
  daemons: {
    list: () => request<Daemon[]>("/api/daemons"),
  },
  config: {
    get: () => request<{ langfuseUrl?: string }>("/api/config"),
  },
  keys: {
    list: () => request<ApiKey[]>("/api/settings/keys"),
    create: (body: { name: string; key: string }) =>
      request<ApiKey>("/api/settings/keys", { method: "POST", body: JSON.stringify(body) }),
    revoke: (id: string) =>
      request<void>(`/api/settings/keys/${id}`, { method: "DELETE" }),
  },
};
