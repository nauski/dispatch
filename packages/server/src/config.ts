export const config = {
  port: parseInt(process.env.PORT || "3000"),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || "postgres://dispatch:dispatch@localhost:5432/dispatch",
  keycloak: {
    issuer: process.env.KEYCLOAK_ISSUER || "",
    jwksUri: process.env.KEYCLOAK_JWKS_URI || "",
    clientId: process.env.KEYCLOAK_CLIENT_ID || "",
  },
  langfuseUrl: process.env.LANGFUSE_URL || "",
  attachments: {
    storagePath: process.env.ATTACHMENT_STORAGE_PATH || "/data/attachments",
    maxSizeBytes: parseInt(process.env.ATTACHMENT_MAX_SIZE || String(50 * 1024 * 1024)),
  },
};
