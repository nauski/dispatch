import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { hashApiKey } from "../auth/index.js";
import { eq } from "drizzle-orm";
import { desc } from "drizzle-orm";

export async function settingsRoutes(app: FastifyInstance) {
  // Register a new API key
  app.post<{ Body: { name: string; key: string } }>(
    "/api/settings/keys",
    async (request, reply) => {
      const { name, key } = request.body;
      const keyHash = hashApiKey(key);
      const keyPrefix = key.slice(0, 8);

      const [created] = await db
        .insert(apiKeys)
        .values({ name, keyHash, keyPrefix })
        .returning();

      reply.code(201);
      return {
        id: created.id,
        name: created.name,
        keyPrefix: created.keyPrefix,
        createdAt: created.createdAt,
      };
    },
  );

  // List all API keys
  app.get("/api/settings/keys", async () => {
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt));

    return keys.map((k) => ({
      ...k,
      revoked: k.revokedAt !== null,
    }));
  });

  // Revoke an API key (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/api/settings/keys/:id",
    async (request, reply) => {
      const [updated] = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.id, request.params.id))
        .returning();

      if (!updated) {
        reply.code(404);
        return { error: "API key not found" };
      }

      return { success: true };
    },
  );
}
