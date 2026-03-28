import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { tasks, taskHistory, taskDependencies, taskAttachments, taskComments, taskExecutions } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { connections } from "../ws/index.js";
import { config } from "../config.js";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join, extname } from "path";

export async function recordHistory(taskId: string, action: string, actor: string, details?: object) {
  await db.insert(taskHistory).values({ taskId, action, actor, details: details ?? null });
}

export function deriveTaskStatus(executions: { status: string }[]): string {
  if (executions.length === 0) return "assigned";
  const statuses = new Set(executions.map(e => e.status));
  if (statuses.has("in_progress")) return "in_progress";
  if (statuses.has("needs_info")) return "needs_info";
  if (statuses.has("assigned")) return "in_progress"; // some done, some still assigned
  // All terminal
  if (executions.every(e => e.status === "done")) return "done";
  if (executions.every(e => e.status === "failed")) return "failed";
  return "done"; // mix of done/failed — task is complete
}

export async function createBroadcastExecutions(task: { id: string; toRole: string | null; targets: string[] | null; excludeTargets: string[] | null }) {
  if (!task.toRole) return [];
  const daemons = connections.getDaemonsForRole(task.toRole, {
    targets: task.targets,
    excludeTargets: task.excludeTargets,
  });

  const executions = [];
  for (const { id: daemonId, conn } of daemons) {
    const [execution] = await db.insert(taskExecutions).values({
      taskId: task.id,
      machineName: conn.machineName,
      daemonId,
    }).returning();
    executions.push(execution);
    connections.pushToDaemon(daemonId, {
      type: "task:assigned",
      task,
      executionId: execution.id,
    });
  }
  return executions;
}

async function checkDependenciesMet(taskId: string): Promise<boolean> {
  const deps = await db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  if (deps.length === 0) return true;
  const depIds = deps.map(d => d.dependsOn);
  const depTasks = await db.select().from(tasks).where(inArray(tasks.id, depIds));
  return depTasks.every(t => t.status === "done");
}

export async function updateExecutionStatus(
  executionId: string,
  status: string,
  result?: string,
  machineName?: string,
) {
  const updateData: Record<string, unknown> = { status };
  if (result) updateData.result = result;
  if (status === "in_progress") updateData.startedAt = new Date();
  if (status === "done" || status === "failed") updateData.completedAt = new Date();

  const [execution] = await db.update(taskExecutions)
    .set(updateData)
    .where(eq(taskExecutions.id, executionId))
    .returning();

  if (!execution) return null;

  // Derive task-level status from all executions
  const allExecutions = await db.select().from(taskExecutions)
    .where(eq(taskExecutions.taskId, execution.taskId));
  const derivedStatus = deriveTaskStatus(allExecutions);

  const [task] = await db.select().from(tasks).where(eq(tasks.id, execution.taskId));
  if (task && task.status !== derivedStatus) {
    const taskUpdate: Record<string, unknown> = { status: derivedStatus, updatedAt: new Date() };
    if (derivedStatus === "done") taskUpdate.completedAt = new Date();
    const [updatedTask] = await db.update(tasks)
      .set(taskUpdate)
      .where(eq(tasks.id, execution.taskId))
      .returning();
    if (updatedTask) {
      connections.broadcastToUI({ type: "task:updated", task: updatedTask });
      if (derivedStatus === "done") {
        await unblockDependents(updatedTask.id);
      }
    }
  }

  // Broadcast execution update to UI
  connections.broadcastToUI({
    type: "task:execution_updated",
    taskId: execution.taskId,
    execution,
  });

  await recordHistory(execution.taskId, `execution:${status}`, `daemon:${machineName || execution.machineName}`, {
    executionId,
    result,
  });

  return execution;
}

export async function unblockDependents(completedTaskId: string) {
  const dependents = await db.select().from(taskDependencies).where(eq(taskDependencies.dependsOn, completedTaskId));
  for (const dep of dependents) {
    if (await checkDependenciesMet(dep.taskId)) {
      const [updated] = await db.update(tasks)
        .set({ status: "assigned", updatedAt: new Date() })
        .where(and(eq(tasks.id, dep.taskId), eq(tasks.status, "backlog")))
        .returning();
      if (updated) {
        await recordHistory(dep.taskId, "unblocked", "system", { unblockedBy: completedTaskId });
        connections.broadcastToUI({ type: "task:updated", task: updated });
        if (updated.toRole) {
          connections.routeTaskAssignment(updated.toRole, { type: "task:assigned", task: updated });
        }
      }
    }
  }
}

export async function taskRoutes(app: FastifyInstance) {
  // List tasks with optional filters
  app.get<{ Querystring: { status?: string; role?: string } }>("/api/tasks", async (request) => {
    const { status, role } = request.query;
    let query = db.select().from(tasks);
    const conditions = [];
    if (status) conditions.push(eq(tasks.status, status));
    if (role) conditions.push(eq(tasks.toRole, role));
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const taskList = await query;

    // Add execution summaries for broadcast tasks
    const broadcastTasks = taskList.filter(t => t.mode === "broadcast");
    if (broadcastTasks.length > 0) {
      const broadcastIds = broadcastTasks.map(t => t.id);
      const executions = await db.select().from(taskExecutions)
        .where(inArray(taskExecutions.taskId, broadcastIds));

      const summaryMap = new Map<string, { total: number; done: number; failed: number; inProgress: number }>();
      for (const exec of executions) {
        let summary = summaryMap.get(exec.taskId);
        if (!summary) {
          summary = { total: 0, done: 0, failed: 0, inProgress: 0 };
          summaryMap.set(exec.taskId, summary);
        }
        summary.total++;
        if (exec.status === "done") summary.done++;
        else if (exec.status === "failed") summary.failed++;
        else if (exec.status === "in_progress") summary.inProgress++;
      }

      return taskList.map(t => t.mode === "broadcast"
        ? { ...t, executionSummary: summaryMap.get(t.id) || { total: 0, done: 0, failed: 0, inProgress: 0 } }
        : t
      );
    }

    return taskList;
  });

  // Get single task with history, dependencies, and executions
  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, request.params.id));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    const history = await db.select().from(taskHistory).where(eq(taskHistory.taskId, task.id));
    const deps = await db.select().from(taskDependencies).where(eq(taskDependencies.taskId, task.id));
    const attachments = await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, task.id));
    const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, task.id));
    const executions = task.mode === "broadcast"
      ? await db.select().from(taskExecutions).where(eq(taskExecutions.taskId, task.id))
      : [];
    return { ...task, history, dependencies: deps, attachments, comments, executions };
  });

  // Create task
  app.post<{
    Body: {
      title: string;
      description?: string;
      fromRole?: string;
      toRole?: string;
      priority?: string;
      requiresApproval?: boolean;
      dependsOn?: string[];
      mode?: string;
      targets?: string[];
      excludeTargets?: string[];
    };
  }>("/api/tasks", async (request, reply) => {
    const { title, description, fromRole, toRole, priority, requiresApproval, dependsOn, mode, targets, excludeTargets } = request.body;

    const taskMode = mode === "broadcast" ? "broadcast" : "single";
    const hasDeps = dependsOn && dependsOn.length > 0;
    const initialStatus = hasDeps ? "backlog" : (toRole ? "assigned" : "backlog");

    const [task] = await db.insert(tasks).values({
      title,
      description,
      fromRole,
      toRole,
      priority,
      requiresApproval,
      status: initialStatus,
      mode: taskMode,
      targets: targets || null,
      excludeTargets: excludeTargets || null,
    }).returning();

    if (dependsOn?.length) {
      for (const depId of dependsOn) {
        await db.insert(taskDependencies).values({ taskId: task.id, dependsOn: depId });
      }
    }

    const actor = fromRole || "web-ui";
    await recordHistory(task.id, "created", actor, taskMode === "broadcast" ? { mode: "broadcast" } : undefined);

    connections.broadcastToUI({ type: "task:created", task });

    // Push to daemon(s) if assigned and no unmet dependencies
    if (task.status === "assigned" && toRole && !task.requiresApproval) {
      if (taskMode === "broadcast") {
        const executions = await createBroadcastExecutions(task);
        await recordHistory(task.id, "broadcast", "system", {
          executionCount: executions.length,
          machines: executions.map(e => e.machineName),
        });
      } else {
        connections.routeTaskAssignment(toRole, { type: "task:assigned", task });
      }
    }

    reply.code(201);
    return task;
  });

  // Update task
  app.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      result?: string;
      title?: string;
      description?: string;
      toRole?: string;
      priority?: string;
      langfuseTraceId?: string;
      actor?: string;
    };
  }>("/api/tasks/:id", async (request, reply) => {
    const { id } = request.params;
    const { actor, ...updates } = request.body;

    const updateData: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    if (updates.status === "done") updateData.completedAt = new Date();

    const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, id)).returning();
    if (!updated) {
      reply.code(404);
      return { error: "Task not found" };
    }

    await recordHistory(id, updates.status ? `status:${updates.status}` : "updated", actor || "unknown", updates);
    connections.broadcastToUI({ type: "task:updated", task: updated });

    if (updates.status === "done") {
      await unblockDependents(id);
    }

    if (updates.status === "assigned" && updated.toRole && !updated.requiresApproval) {
      connections.routeTaskAssignment(updated.toRole, { type: "task:assigned", task: updated });
    }

    return updated;
  });

  // Approve task
  app.post<{ Params: { id: string }; Body: { approvedBy: string } }>(
    "/api/tasks/:id/approve",
    async (request, reply) => {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, request.params.id));
      if (!task) {
        reply.code(404);
        return { error: "Task not found" };
      }
      if (!task.requiresApproval) {
        reply.code(400);
        return { error: "Task does not require approval" };
      }

      const [updated] = await db.update(tasks).set({
        approvedBy: request.body.approvedBy,
        approvedAt: new Date(),
        status: "assigned",
        updatedAt: new Date(),
      }).where(eq(tasks.id, task.id)).returning();

      await recordHistory(task.id, "approved", request.body.approvedBy);
      connections.broadcastToUI({ type: "task:updated", task: updated });

      if (updated.toRole) {
        connections.routeTaskAssignment(updated.toRole, { type: "task:assigned", task: updated });
      }

      return updated;
    }
  );

  // Upload attachment
  app.post<{ Params: { id: string } }>("/api/tasks/:id/attachments", async (request, reply) => {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, request.params.id));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    const buffer = await file.toBuffer();
    if (buffer.length > config.attachments.maxSizeBytes) {
      reply.code(413);
      return { error: "File too large" };
    }

    const fileId = randomUUID();
    const ext = extname(file.filename);
    const storagePath = join(config.attachments.storagePath, task.id, `${fileId}${ext}`);

    await mkdir(join(config.attachments.storagePath, task.id), { recursive: true });
    await writeFile(storagePath, buffer);

    const [attachment] = await db.insert(taskAttachments).values({
      taskId: task.id,
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
      storagePath,
      uploadedBy: "web-ui",
    }).returning();

    reply.code(201);
    return attachment;
  });

  // Get task history
  app.get<{ Params: { id: string } }>("/api/tasks/:id/history", async (request) => {
    return db.select().from(taskHistory).where(eq(taskHistory.taskId, request.params.id));
  });

  // List comments for a task
  app.get<{ Params: { id: string } }>("/api/tasks/:id/comments", async (request) => {
    return db.select().from(taskComments).where(eq(taskComments.taskId, request.params.id));
  });

  // Post a comment on a task
  app.post<{
    Params: { id: string };
    Body: { author: string; body: string };
  }>("/api/tasks/:id/comments", async (request, reply) => {
    const { id } = request.params;
    const { author, body } = request.body;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }

    const [comment] = await db.insert(taskComments).values({
      taskId: id,
      author,
      body,
    }).returning();

    await recordHistory(id, "comment", author, { body });
    connections.broadcastToUI({ type: "task:comment", taskId: id, comment });

    if (!author.startsWith("daemon:") && task.toRole) {
      const comments = await db.select().from(taskComments).where(eq(taskComments.taskId, id));

      if (task.status === "needs_info") {
        // Auto-transition back to assigned and re-push for execution
        const [updated] = await db.update(tasks)
          .set({ status: "assigned", updatedAt: new Date() })
          .where(and(eq(tasks.id, id), eq(tasks.status, "needs_info")))
          .returning();

        if (updated) {
          await recordHistory(id, "status:assigned", "system", { reason: "reply received" });
          connections.broadcastToUI({ type: "task:updated", task: updated });
          connections.routeTaskAssignment(updated.toRole!, {
            type: "task:assigned",
            task: updated,
            context: { comments },
          });
        }
      } else if (task.status === "done" || task.status === "failed") {
        // Notify daemon for a conversational reply — no status change
        connections.pushToRole(task.toRole, {
          type: "task:comment_notification",
          task,
          comment,
          comments,
        });
      }
    }

    reply.code(201);
    return comment;
  });

  // Daemons status
  app.get("/api/daemons", async () => {
    return connections.getConnectedDaemons();
  });
}
