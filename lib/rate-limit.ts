import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Rule = { name: string; limit: number; windowMs: number };

export const RULES = {
  ip: { name: "ip", limit: 5, windowMs: HOUR },
  email: { name: "email", limit: 3, windowMs: HOUR },
  global: { name: "global", limit: 200, windowMs: DAY }, // limit overridden by TICKETS_DAILY_LIMIT
} satisfies Record<string, Rule>;

export type RateLimitResult = { ok: true } | { ok: false; rule: string };

/**
 * Fixed-window limits, checked in order. Stops at the first rule that's over
 * its limit, so a blocked IP doesn't also use up the email or global budget.
 */
export async function checkRateLimits(ip: string, email: string): Promise<RateLimitResult> {
  const checks: [Rule, string][] = [
    [RULES.ip, ip],
    [RULES.email, email.toLowerCase()],
    [{ ...RULES.global, limit: env().TICKETS_DAILY_LIMIT }, "all"],
  ];

  for (const [rule, id] of checks) {
    const count = await hit(rule, id);
    if (count > rule.limit) return { ok: false, rule: rule.name };
  }
  return { ok: true };
}

/** Increments the counter for this rule/id in the current window; returns the new count. */
async function hit(rule: Rule, id: string): Promise<number> {
  const window = Math.floor(Date.now() / rule.windowMs);
  // Hash identifiers so raw IPs and emails never sit in the store.
  const key = `tickets:rl:${rule.name}:${sha256(id)}:${window}`;
  const ttlSeconds = Math.ceil(rule.windowMs / 1000);

  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env();
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await hitUpstash(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, key, ttlSeconds);
    } catch (err) {
      // Fail open on store outages: Turnstile still guards the form, and we'd
      // rather not block every real user because Redis is down.
      console.error("[rate-limit] store error, allowing request", err);
      return 0;
    }
  }

  warnInMemoryOnce();
  return hitMemory(key, rule.windowMs);
}

async function hitUpstash(url: string, token: string, key: string, ttlSeconds: number) {
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(ttlSeconds)],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const [incr] = (await res.json()) as [{ result?: number; error?: string }];
  if (typeof incr?.result !== "number") throw new Error(`Upstash: ${incr?.error ?? "bad response"}`);
  return incr.result;
}

// --- In-memory fallback (single server / local dev only) --------------------

const memory = new Map<string, { count: number; expiresAt: number }>();

function hitMemory(key: string, windowMs: number) {
  const now = Date.now();
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
  }
  const entry = memory.get(key);
  if (!entry || entry.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

let warned = false;
function warnInMemoryOnce() {
  if (warned || process.env.NODE_ENV !== "production") return;
  warned = true;
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL not set; using in-memory limits. " +
      "These are per-instance and reset on restart, so they don't hold on serverless hosts.",
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
