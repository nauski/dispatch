import { config } from "./config.js";

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getToken(): Promise<string> {
  // Shared key auth — no token exchange needed
  if (config.auth.key) {
    return config.auth.key;
  }

  // Keycloak client credentials flow
  if (!config.auth.tokenEndpoint || !config.auth.clientSecret) {
    throw new Error("No auth configured: set auth.key or auth.tokenEndpoint + auth.clientSecret");
  }

  // Return cached token if still valid (with 30s margin)
  if (cachedToken && Date.now() < tokenExpiry - 30_000) {
    return cachedToken;
  }

  const res = await fetch(config.auth.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.auth.clientId,
      client_secret: config.auth.clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;

  return cachedToken;
}
