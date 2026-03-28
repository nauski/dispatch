import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "crypto";
import { eq, isNull, and } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthPayload;
  }
}

const keycloakConfigured =
  config.keycloak.jwksUri !== "" && config.keycloak.issuer !== "";

const jwks = keycloakConfigured
  ? createRemoteJWKSet(new URL(config.keycloak.jwksUri))
  : undefined;

export interface AuthPayload extends JWTPayload {
  preferred_username?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function verifyJwt(token: string): Promise<AuthPayload> {
  if (!jwks) {
    throw new Error("Keycloak is not configured");
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.keycloak.issuer,
  });
  return payload as AuthPayload;
}

async function verifyApiKey(token: string): Promise<AuthPayload> {
  const hash = hashApiKey(token);
  const [found] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!found) {
    throw new Error("Invalid API key");
  }

  // Update last_used_at in the background
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, found.id))
    .then(() => {}, () => {});

  return { sub: `apikey:${found.id}`, preferred_username: found.name } as AuthPayload;
}

export async function verifyAuth(token: string): Promise<AuthPayload> {
  const looksLikeJwt = token.startsWith("eyJ");

  if (looksLikeJwt && keycloakConfigured) {
    return verifyJwt(token);
  }

  return verifyApiKey(token);
}

/** @deprecated Use verifyAuth instead */
export const verifyToken = verifyAuth;

export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid authorization header" });
    return;
  }
  try {
    const token = authHeader.slice(7);
    request.user = await verifyAuth(token);
  } catch {
    reply.code(401).send({ error: "Invalid token" });
  }
}
