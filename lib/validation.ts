import { z } from "zod";

// Platforms users can pick, and that may link here via `?source=<slug>`.
// The label is what gets stored in Zoho's Source field, so if that field is a
// dropdown, every label here must also exist as an option in Zoho.
export const SOURCES = ["career-bridge"] as const;
export const DEFAULT_SOURCE = "career-bridge";

export const SOURCE_LABELS: Record<Source, string> = {
  "career-bridge": "Career Bridge",
};

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export const CATEGORIES = [
  "Bug",
  "Account / Login",
  "Feature Request",
  "Other",
] as const;

export type Source = (typeof SOURCES)[number];

export function resolveSource(value: unknown): Source {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SOURCES as readonly string[]).includes(v) ? (v as Source) : DEFAULT_SOURCE;
}

export const ticketSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(100),
  email: z.email("Please enter a valid email address.").trim().max(254),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters.")
    .max(255, "Subject must be 255 characters or fewer."),
  description: z
    .string()
    .trim()
    .min(10, "Please describe the issue in at least 10 characters.")
    .max(10000, "Description must be 10,000 characters or fewer."),
  priority: z.enum(PRIORITIES, "Please choose a priority."),
  category: z.enum(CATEGORIES, "Please choose a category."),
  source: z.enum(SOURCES, "Please choose a platform."),
});

export type TicketInput = z.infer<typeof ticketSchema>;
export type TicketField = keyof TicketInput;
