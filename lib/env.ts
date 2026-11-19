import "server-only";
import { z } from "zod";

const envSchema = z
  .object({
    ZOHO_DC: z
      .string()
      .regex(/^[a-z.]+$/, "must be a Zoho data center suffix like com, eu, in, com.au")
      .default("com"),
    ZOHO_CLIENT_ID: z.string().min(1),
    ZOHO_CLIENT_SECRET: z.string().min(1),
    ZOHO_REFRESH_TOKEN: z.string().min(1),
    ZOHO_ORG_ID: z.string().min(1),
    ZOHO_TECH_DEPARTMENT_ID: z.string().min(1),
    ZOHO_SOURCE_FIELD: z.string().min(1).default("cf_source"),

    // Shared rate-limit store. Without it, limits are kept in memory, which
    // only works when the app runs as a single long-lived server.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    // Cap on tickets per day across the whole form, to protect the shared
    // Zoho org's API quota and other teams' queues.
    TICKETS_DAILY_LIMIT: z.coerce.number().int().positive().default(200),

    RESEND_API_KEY: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (!!e.UPSTASH_REDIS_REST_URL !== !!e.UPSTASH_REDIS_REST_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["UPSTASH_REDIS_REST_TOKEN"],
        message: "set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Validated lazily so `next build` works without secrets, but the first
// request fails fast with a clear message if anything is missing.
export function env(): Env {
  if (cached) return cached;

  // Treat empty strings (e.g. copied from .env.example) as missing.
  const raw: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== ""),
  );
  // Vercel's Upstash integration names these KV_REST_API_*.
  raw.UPSTASH_REDIS_REST_URL ??= raw.KV_REST_API_URL;
  raw.UPSTASH_REDIS_REST_TOKEN ??= raw.KV_REST_API_TOKEN;
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables (see .env.example):\n${problems}`,
    );
  }

  cached = result.data;
  return cached;
}
