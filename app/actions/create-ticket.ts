"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { checkRateLimits } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { ticketSchema, type TicketField } from "@/lib/validation";
import { createTicket } from "@/lib/zoho/tickets";

export type CreateTicketState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      attempt: number;
      fieldErrors?: Partial<Record<TicketField, string>>;
      values?: Partial<Record<TicketField, string>>;
    }
  | { status: "success"; ticketNumber: string };

const GENERIC_FAILURE =
  "We couldn't submit your request right now. Please try again in a few minutes.";

// This action is a public POST endpoint: anyone can call it directly without
// going through the form, so every check below runs on the server.
// Order: cheapest checks first, the Zoho call last.
export async function createTicketAction(
  _prev: CreateTicketState,
  formData: FormData,
): Promise<CreateTicketState> {
  const values = Object.fromEntries(
    Object.keys(ticketSchema.shape).map((k) => [k, String(formData.get(k) ?? "")]),
  ) as Record<TicketField, string>;
  const fail = (
    message: string,
    fieldErrors?: Partial<Record<TicketField, string>>,
  ): CreateTicketState => ({
    status: "error",
    message,
    attempt: Date.now(),
    fieldErrors,
    values,
  });

  // 1. Honeypot: real users never see this field.
  if (String(formData.get("website") ?? "") !== "") {
    console.warn("[create-ticket] honeypot triggered");
    return fail(GENERIC_FAILURE);
  }

  // 2. Field validation.
  const parsed = ticketSchema.safeParse(values);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return fail(
      "Please fix the highlighted fields.",
      Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]])),
    );
  }

  try {
    const ip = clientIp(await headers());

    // 3. Bot check (Cloudflare Turnstile).
    const human = await verifyTurnstile(
      String(formData.get("cf-turnstile-response") ?? ""),
      ip,
    );
    if (human !== "ok") {
      return fail(
        human === "missing"
          ? "Please wait for the security check to finish, then submit again."
          : "The security check failed. Please try again.",
      );
    }

    // 4. Rate limits (per IP, per email, and a daily cap on the whole form).
    const limit = await checkRateLimits(ip ?? "unknown", parsed.data.email);
    if (!limit.ok) {
      console.warn(`[create-ticket] rate limited (${limit.rule})`);
      return fail(
        limit.rule === "global"
          ? GENERIC_FAILURE
          : "You've sent several requests recently. Please wait an hour before submitting another.",
      );
    }

    // 5. Create the ticket in Zoho.
    const ticket = await createTicket(parsed.data);
    return { status: "success", ticketNumber: ticket.ticketNumber };
  } catch (err) {
    // Full error stays in the server logs; the user gets a generic message.
    console.error("[create-ticket] failed", err);
    return fail(GENERIC_FAILURE);
  }
}

// The host (Vercel, Netlify, Render, a reverse proxy…) must set these headers
// itself. If requests reach the app directly, a client could forge them and
// dodge the per-IP limit, though Turnstile and the other limits still apply.
function clientIp(h: Headers): string | undefined {
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    undefined
  );
}
