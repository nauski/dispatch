import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { taskRoutes } from "./routes/tasks.js";
import { roleRoutes } from "./routes/roles.js";
import { settingsRoutes } from "./routes/settings.js";
import { connections } from "./ws/index.js";
import { verifyAuth } from "./auth/index.js";
import { db } from "./db/index.js";
import { tasks, roles } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { recordHistory, unblockDependents, updateExecutionStatus } from "./routes/tasks.js";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });
await app.register(fastifyMultipart, { limits: { fileSize: config.attachments.maxSizeBytes } });
await app.register(fastifyWebsocket);

// Serve install script for: curl -fsSL your-server:3000/install.sh | bash
// In Docker: copied to packages/server/install.sh (../install.sh from dist/)
// In dev/repo: at repo root (../../../install.sh from src/)
function findScript(name: string): string | undefined {
  return [
    resolve(import.meta.dirname, `../${name}`),
    resolve(import.meta.dirname, `../../../${name}`),
  ].find(p => existsSync(p));
}

for (const script of ["install.sh", "uninstall.sh"]) {
  const scriptPath = findScript(script);
  app.get(`/${script}`, async (_request, reply) => {
    if (scriptPath) {
      return reply.type("text/plain").send(readFileSync(scriptPath, "utf-8"));
    }
    reply.code(404).send(`${script} not found`);
  });
}

// Serve web UI static files in production
const webDistPath = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDistPath)) {
  await app.register(fastifyStatic, { root: webDistPath, prefix: "/" });
}

// REST API routes
await app.register(taskRoutes);
await app.register(roleRoutes);
await app.register(settingsRoutes);

// Health check
app.get("/api/health", async () => ({ status: "ok" }));

// Client config (public, no auth) — exposes non-sensitive settings to the web UI
app.get("/api/config", async () => ({
  langfuseUrl: config.langfuseUrl || undefined,
}));

// SSE endpoint for waiting on task completion
const TERMINAL_STATUSES = new Set(["done", "failed", "needs_info"]);

app.get<{ Params: { id: string }; Querystring: { timeout?: string } }>(
  "/api/tasks/:id/wait",
  async (request, reply) => {
    const { id } = request.params;
    const timeout = Math.min(parseInt(request.query.timeout || "300000", 10), 600000);

    // Check if task already in terminal state
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) {
      reply.code(404).send({ error: "Task not found" });
      return;
    }

    if (TERMINAL_STATUSES.has(task.status)) {
      reply
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive");
      reply.raw.write(`data: ${JSON.stringify(task)}\n\n`);
      reply.raw.end();
      return;
    }

    // Set up SSE stream
    reply
      .header("Content-Type", "text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("Connection", "keep-alive");
    reply.raw.write(":ok\n\n");

    const eventName = `task:${id}`;
    let done = false;

    const onTaskUpdate = (updatedTask: Record<string, unknown>) => {
      if (done) return;
      if (TERMINAL_STATUSES.has(updatedTask.status as string)) {
        done = true;
        reply.raw.write(`data: ${JSON.stringify(updatedTask)}\n\n`);
        reply.raw.end();
        cleanup();
      }
    };

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reply.raw.write(`event: timeout\ndata: {}\n\n`);
        reply.raw.end();
        cleanup();
      }
    }, timeout);

    const cleanup = () => {
      connections.taskEvents.removeListener(eventName, onTaskUpdate);
      clearTimeout(timer);
    };

    connections.taskEvents.on(eventName, onTaskUpdate);

    request.raw.on("close", () => {
      done = true;
      cleanup();
    });
  },
);

// WebSocket endpoint for daemons
app.get("/ws/daemon", { websocket: true }, (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get("token");
  const machineName = url.searchParams.get("machine") || "unknown";
  const rolesParam = url.searchParams.get("roles") || "";
  const daemonRoles = rolesParam.split(",").filter(Boolean);
  const connectionType = (url.searchParams.get("type") || "daemon") as "daemon" | "executor" | "runner";
  const id = crypto.randomUUID();

  // Attach event handlers synchronously (required by @fastify/websocket)
  socket.on("close", () => {
    connections.broadcastToUI({ type: "daemon:disconnected", daemonId: id });
  });

  socket.on("message", async (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Tool execution relay: runner → executor
      if (msg.type === "tool:execute" && msg.requestId && msg.targetRole && msg.tool) {
        const executor = connections.getExecutorForRole(msg.targetRole);
        if (executor) {
          connections.addPendingToolRequest(msg.requestId, id);
          connections.pushToExecutor(executor.id, {
            type: "tool:execute",
            requestId: msg.requestId,
            targetRole: msg.targetRole,
            tool: msg.tool,
            params: msg.params,
          });
        } else {
          // No executor available — send error back to runner
          socket.send(JSON.stringify({
            type: "tool:result",
            requestId: msg.requestId,
            output: `No executor connected for role: ${msg.targetRole}`,
            error: true,
          }));
        }
        return;
      }

      // Tool result relay: executor → runner
      if (msg.type === "tool:result" && msg.requestId) {
        const runnerId = connections.resolvePendingToolRequest(msg.requestId);
        if (runnerId) {
          connections.pushToRunner(runnerId, {
            type: "tool:result",
            requestId: msg.requestId,
            output: msg.output,
            error: msg.error ?? false,
          });
        }
        return;
      }

      if (msg.type === "task:status" && msg.taskId && msg.status) {
        // Execution-aware: if the daemon sends an executionId, update the execution
        if (msg.executionId) {
          await updateExecutionStatus(msg.executionId, msg.status, msg.result, machineName);
        } else {
          // Single-mode task or legacy daemon: update the task directly
          const updateData: Record<string, unknown> = {
            status: msg.status,
            updatedAt: new Date(),
          };
          if (msg.result) updateData.result = msg.result;
          if (msg.status === "done") updateData.completedAt = new Date();

          const [updated] = await db.update(tasks)
            .set(updateData)
            .where(eq(tasks.id, msg.taskId))
            .returning();

          if (updated) {
            await recordHistory(msg.taskId, `status:${msg.status}`, `daemon:${machineName}`, {
              result: msg.result,
            });
            connections.broadcastToUI({ type: "task:updated", task: updated });

            if (msg.status === "done") {
              await unblockDependents(msg.taskId);
            }
          }
        }
      }
    } catch (err) {
      app.log.error({ err }, "Error processing daemon message");
    }
  });

  // Now do async work (auth, role creation) after handlers are attached
  (async () => {
    if (!token) {
      socket.close(4001, "Missing token");
      return;
    }

    try {
      await verifyAuth(token);
    } catch {
      socket.close(4003, "Invalid token");
      return;
    }

    // Auto-create roles that don't exist yet
    try {
      for (const roleName of daemonRoles) {
        await db.insert(roles).values({ name: roleName }).onConflictDoNothing();
      }
    } catch (err) {
      app.log.warn({ err }, "Failed to auto-create roles, continuing anyway");
    }

    connections.addDaemon(id, socket, machineName, daemonRoles, connectionType);
    app.log.info({ id, machineName, roles: daemonRoles, type: connectionType }, "Daemon connected");
    connections.broadcastToUI({ type: "daemon:connected", daemon: { id, machineName, roles: daemonRoles, type: connectionType } });
  })().catch((err) => {
    app.log.error({ err }, "Daemon connection setup failed");
    socket.close(4500, "Internal error");
  });
});

// WebSocket endpoint for web UI
app.get("/ws/ui", { websocket: true }, async (socket) => {
  connections.addUIClient(socket);
});

// SPA fallback — serve index.html for non-API, non-file routes
app.setNotFoundHandler(async (request, reply) => {
  if (!request.url.startsWith("/api/") && !request.url.startsWith("/ws/") && existsSync(webDistPath)) {
    return reply.sendFile("index.html");
  }
  reply.code(404).send({ error: "Not found" });
});

await app.listen({ port: config.port, host: config.host });
app.log.info(`Dispatch server listening on ${config.host}:${config.port}`);
