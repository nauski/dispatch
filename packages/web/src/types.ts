export interface Task {
  id: string;
  title: string;
  description: string | null;
  fromRole: string | null;
  toRole: string | null;
  status: string;
  priority: string | null;
  requiresApproval: boolean | null;
  approvedBy: string | null;
  approvedAt: string | null;
  mode: "single" | "broadcast";
  targets: string[] | null;
  excludeTargets: string[] | null;
  result: string | null;
  langfuseTraceId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  executionSummary?: {
    total: number;
    done: number;
    failed: number;
    inProgress: number;
  };
}

export interface TaskExecution {
  id: string;
  taskId: string;
  machineName: string;
  daemonId: string | null;
  status: string;
  result: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  allowedActions: string[] | null;
  createdAt: string;
}

export interface Daemon {
  id: string;
  machineName: string;
  roles: string[];
  type?: "daemon" | "executor" | "runner";
  connected: boolean;
}

export interface Comment {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const COLUMNS = ["backlog", "assigned", "in_progress", "needs_info", "done", "failed"] as const;
export type Column = typeof COLUMNS[number];

export const COLUMN_LABELS: Record<Column, string> = {
  backlog: "Backlog",
  assigned: "Assigned",
  in_progress: "In Progress",
  needs_info: "Needs Info",
  done: "Done",
  failed: "Failed",
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};
