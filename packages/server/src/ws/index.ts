import type { WebSocket } from "ws";
import { EventEmitter } from "events";

type ConnectionType = "daemon" | "executor" | "runner";

interface DaemonConnection {
  ws: WebSocket;
  machineName: string;
  roles: string[];
  type: ConnectionType;
}

interface UIConnection {
  ws: WebSocket;
}

interface PendingToolRequest {
  runnerId: string;
  timer: ReturnType<typeof setTimeout>;
}

const TOOL_REQUEST_TIMEOUT_MS = 120_000;

class ConnectionManager {
  private daemons = new Map<string, DaemonConnection>();
  private uiClients = new Set<UIConnection>();
  private pendingToolRequests = new Map<string, PendingToolRequest>();
  readonly taskEvents = new EventEmitter();

  addDaemon(id: string, ws: WebSocket, machineName: string, roles: string[], type: ConnectionType = "daemon") {
    this.daemons.set(id, { ws, machineName, roles, type });
    ws.on("close", () => this.daemons.delete(id));
  }

  addUIClient(ws: WebSocket) {
    const conn: UIConnection = { ws };
    this.uiClients.add(conn);
    ws.on("close", () => this.uiClients.delete(conn));
  }

  pushToRole(role: string, event: object) {
    const message = JSON.stringify(event);
    for (const { conn } of this.getDaemonsForRole(role)) {
      conn.ws.send(message);
    }
  }

  broadcastToUI(event: object) {
    const message = JSON.stringify(event);
    for (const client of this.uiClients) {
      if (client.ws.readyState === 1) {
        client.ws.send(message);
      }
    }
    // Emit for SSE task waiters
    const e = event as Record<string, unknown>;
    if ((e.type === "task:updated" || e.type === "task:created") && e.task) {
      const task = e.task as Record<string, unknown>;
      if (task.id) {
        this.taskEvents.emit(`task:${task.id}`, task);
      }
    }
  }

  pushToDaemon(id: string, event: object) {
    const daemon = this.daemons.get(id);
    if (daemon && daemon.ws.readyState === 1) {
      daemon.ws.send(JSON.stringify(event));
    }
  }

  pushToRunner(id: string, event: object) {
    const conn = this.daemons.get(id);
    if (conn && conn.type === "runner" && conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(event));
    }
  }

  pushToExecutor(id: string, event: object) {
    const conn = this.daemons.get(id);
    if (conn && conn.type === "executor" && conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(event));
    }
  }

  getExecutorForRole(role: string): { id: string; conn: DaemonConnection } | undefined {
    for (const [id, conn] of this.daemons) {
      if (conn.type === "executor" && conn.roles.includes(role) && conn.ws.readyState === 1) {
        return { id, conn };
      }
    }
    return undefined;
  }

  getRunner(): { id: string; conn: DaemonConnection } | undefined {
    for (const [id, conn] of this.daemons) {
      if (conn.type === "runner" && conn.ws.readyState === 1) {
        return { id, conn };
      }
    }
    return undefined;
  }

  getDaemonsForRole(role: string, opts?: { targets?: string[] | null; excludeTargets?: string[] | null; type?: ConnectionType }): { id: string; conn: DaemonConnection }[] {
    const filterType = opts?.type ?? "daemon";
    const result: { id: string; conn: DaemonConnection }[] = [];
    for (const [id, daemon] of this.daemons) {
      if (daemon.type !== filterType) continue;
      if (!daemon.roles.includes(role)) continue;
      if (daemon.ws.readyState !== 1) continue;
      if (opts?.targets?.length && !opts.targets.includes(daemon.machineName)) continue;
      if (opts?.excludeTargets?.length && opts.excludeTargets.includes(daemon.machineName)) continue;
      result.push({ id, conn: daemon });
    }
    return result;
  }

  getConnectedDaemons() {
    return Array.from(this.daemons.entries()).map(([id, d]) => ({
      id,
      machineName: d.machineName,
      roles: d.roles,
      type: d.type,
      connected: d.ws.readyState === 1,
    }));
  }

  /** Register a pending tool:execute request for routing the result back */
  addPendingToolRequest(requestId: string, runnerId: string) {
    const timer = setTimeout(() => {
      this.pendingToolRequests.delete(requestId);
      this.pushToRunner(runnerId, {
        type: "tool:result",
        requestId,
        output: "Tool execution timed out after 120s",
        error: true,
      });
    }, TOOL_REQUEST_TIMEOUT_MS);
    this.pendingToolRequests.set(requestId, { runnerId, timer });
  }

  /** Resolve a pending tool request — returns the runnerId to route the result to */
  resolvePendingToolRequest(requestId: string): string | undefined {
    const pending = this.pendingToolRequests.get(requestId);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pendingToolRequests.delete(requestId);
    return pending.runnerId;
  }

  /**
   * Route a task assignment considering connection types.
   * If a daemon exists for the role, push directly (existing behavior).
   * If no daemon but an executor exists, push to the runner with executor metadata.
   * Returns true if the task was routed to someone.
   */
  routeTaskAssignment(role: string, event: object, opts?: { targets?: string[] | null; excludeTargets?: string[] | null }): boolean {
    // First try daemon connections (backward-compatible default)
    const daemons = this.getDaemonsForRole(role, { ...opts, type: "daemon" });
    if (daemons.length > 0) {
      const message = JSON.stringify(event);
      for (const { conn } of daemons) {
        conn.ws.send(message);
      }
      return true;
    }

    // No daemons — check for executor + runner combo
    const executor = this.getExecutorForRole(role);
    if (executor) {
      const runner = this.getRunner();
      if (runner) {
        this.pushToRunner(runner.id, {
          ...event as Record<string, unknown>,
          targetExecutor: executor.id,
        });
        return true;
      }
    }

    return false;
  }
}

export const connections = new ConnectionManager();
