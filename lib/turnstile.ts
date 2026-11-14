import "server-only";
import { env } from "@/lib/env";

// Must match the `action` the widget is rendered with in components/Turnstile.tsx,
// so a token minted for some other form can't be replayed here.
export const TURNSTILE_ACTION = "create-ticket";

export type TurnstileResult = "ok" | "missing" | "failed";

/**
 * Verifies a Turnstile token with Cloudflare. Tokens are single-use and
 * expire after 5 minutes. Fails closed: any network or Cloudflare error
 * counts as a failed check.
 */
export async function verifyTurnstile(
  token: string,
  remoteIp: string | undefined,
): Promise<TurnstileResult> {
  const { TURNSTILE_SECRET_KEY } = env();

  if (!TURNSTILE_SECRET_KEY) {
    // Only reachable outside production: env() refuses to run without it there.
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set; skipping bot check (dev only)");
    return "ok";
  }
  if (!token) return "missing";

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as {
      success?: boolean;
      action?: string;
      "error-codes"?: string[];
    };

    if (!data.success) {
      console.warn("[turnstile] rejected", data["error-codes"]);
      return "failed";
    }
    // Cloudflare's always-pass test secret returns no action, so only skip the
    // action check for that key.
    const isTestSecret = TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA";
    if (data.action !== TURNSTILE_ACTION && !isTestSecret) {
      console.warn("[turnstile] unexpected action", data.action);
      return "failed";
    }
    return "ok";
  } catch (err) {
    console.error("[turnstile] verification error", err);
    return "failed";
  }
}
