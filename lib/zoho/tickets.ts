import "server-only";
import { env } from "@/lib/env";
import { SOURCE_LABELS, type TicketInput } from "@/lib/validation";
import { clearAccessToken, getAccessToken } from "./auth";

export class ZohoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ZohoApiError";
  }
}

export type CreatedTicket = { id: string; ticketNumber: string };

export async function createTicket(input: TicketInput): Promise<CreatedTicket> {
  const { ZOHO_DC, ZOHO_ORG_ID, ZOHO_TECH_DEPARTMENT_ID, ZOHO_SOURCE_FIELD } = env();
  const { firstName, lastName } = splitName(input.name);

  const body = JSON.stringify({
    subject: input.subject,
    // Zoho reuses an existing contact (matched by email, shared across all
    // departments) and ignores the name we send for it, so the name typed in
    // the form would otherwise be lost. Put it on the ticket itself.
    description:
      `<b>Submitted by:</b> ${toHtml(input.name)} (${toHtml(input.email)})<br>` +
      `<b>Platform:</b> ${toHtml(SOURCE_LABELS[input.source])}<br><br>` +
      toHtml(input.description),
    departmentId: ZOHO_TECH_DEPARTMENT_ID,
    priority: input.priority,
    category: input.category,
    channel: "Web",
    email: input.email,
    contact: { email: input.email, firstName, lastName },
    cf: { [ZOHO_SOURCE_FIELD]: SOURCE_LABELS[input.source] },
  });

  const send = async () =>
    fetch(`https://desk.zoho.${ZOHO_DC}/api/v1/tickets`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${await getAccessToken()}`,
        orgId: ZOHO_ORG_ID,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

  let res = await send();
  if (res.status === 401) {
    // Token revoked or expired early; fetch a fresh one and retry once.
    clearAccessToken();
    res = await send();
  }

  const data = (await res.json().catch(() => null)) as {
    id?: string;
    ticketNumber?: string;
    errorCode?: string;
    message?: string;
  } | null;

  if (!res.ok || !data?.id || !data.ticketNumber) {
    throw new ZohoApiError(
      `Zoho ticket creation failed: ${data?.errorCode ?? `HTTP ${res.status}`}${
        data?.message ? ` (${data.message})` : ""
      }`,
      res.status,
      data,
    );
  }

  return { id: data.id, ticketNumber: data.ticketNumber };
}

// Zoho requires lastName on a contact; firstName is optional.
function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: undefined, lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

// Ticket descriptions are rendered as HTML in Zoho, so escape user input and
// keep the line breaks.
function toHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
}
