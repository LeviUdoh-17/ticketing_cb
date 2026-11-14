import "server-only";
import { env } from "@/lib/env";

export class ZohoAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ZohoAuthError";
  }
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cachedToken: { value: string; expiresAt: number } | null = null;
// Shares one in-flight refresh between concurrent requests, so a burst of
// submissions doesn't trip Zoho's token-generation rate limit.
let inflight: Promise<string> | null = null;

export function clearAccessToken() {
  cachedToken = null;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - REFRESH_MARGIN_MS) {
    return cachedToken.value;
  }
  inflight ??= refreshAccessToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refreshAccessToken(): Promise<string> {
  const { ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = env();

  const res = await fetch(`https://accounts.zoho.${ZOHO_DC}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      refresh_token: ZOHO_REFRESH_TOKEN,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  } | null;

  // Zoho returns 200 with `{ error: "invalid_code" }` for bad credentials,
  // so check the body as well as the status.
  if (!res.ok || !data?.access_token) {
    throw new ZohoAuthError(
      `Zoho token refresh failed: ${data?.error ?? `HTTP ${res.status}`}`,
      res.status,
      data,
    );
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}
