import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { roles } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function roleRoutes(app: FastifyInstance) {
  app.get("/api/roles", async () => {
    return db.select().from(roles);
  });

  app.post<{ Body: { name: string; description?: string; allowedActions?: string[] } }>(
    "/api/roles",
    async (request, reply) => {
      const { name, description, allowedActions } = request.body;
      const [role] = await db.insert(roles).values({ name, description, allowedActions }).returning();
      reply.code(201);
      return role;
    }
  );

  app.delete<{ Params: { name: string } }>("/api/roles/:name", async (request, reply) => {
    const deleted = await db.delete(roles).where(eq(roles.name, request.params.name)).returning();
    if (deleted.length === 0) {
      reply.code(404);
      return { error: "Role not found" };
    }
    return deleted[0];
  });
}
