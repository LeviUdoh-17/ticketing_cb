"use client";

import { useActionState } from "react";
import {
  createTicketAction,
  type CreateTicketState,
} from "@/app/actions/create-ticket";
import {
  CATEGORIES,
  PRIORITIES,
  SOURCES,
  SOURCE_LABELS,
  type Source,
  type TicketField,
} from "@/lib/validation";
import { Turnstile } from "./Turnstile";

const initialState: CreateTicketState = { status: "idle" };

const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm " +
  "placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 " +
  "aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/30 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// turnstileSiteKey is read on the server at request time (not inlined at build
// like NEXT_PUBLIC_ vars). When unset (local dev only), the widget is skipped
// and the server skips verification too.
export function TicketForm({
  source,
  turnstileSiteKey,
}: {
  source: Source;
  turnstileSiteKey?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createTicketAction,
    initialState,
  );

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950"
      >
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-100">
          Request received
        </h2>
        <p className="mt-2 text-sm text-green-800 dark:text-green-200">
          Your ticket number is{" "}
          <span className="font-mono text-base font-semibold">
            #{state.ticketNumber}
          </span>
          . Please keep it for reference — our team will be in touch by email.
        </p>
        <a
          href={`?source=${source}`}
          className="mt-4 inline-block text-sm font-medium text-green-900 underline dark:text-green-100"
        >
          Submit another request
        </a>
      </div>
    );
  }

  const errors = state.status === "error" ? state.fieldErrors ?? {} : {};
  const values = state.status === "error" ? state.values ?? {} : {};

  const field = (name: TicketField) => ({
    id: name,
    name,
    defaultValue: values[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  return (
    // Remount after each failed submit so React's automatic form reset
    // doesn't wipe what the user typed (and selects pick up defaultValue).
    <form
      key={state.status === "error" ? state.attempt : 0}
      action={formAction}
      noValidate
      className="space-y-5"
    >
      {state.status === "error" && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.message}
        </div>
      )}

      <Field label="Platform" name="source" error={errors.source}>
        <select {...field("source")} defaultValue={values.source ?? source} required className={inputClass}>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" name="name" error={errors.name}>
          <input {...field("name")} type="text" autoComplete="name" required className={inputClass} />
        </Field>
        <Field label="Email" name="email" error={errors.email}>
          <input {...field("email")} type="email" autoComplete="email" required className={inputClass} />
        </Field>
      </div>

      <Field label="Subject" name="subject" error={errors.subject}>
        <input {...field("subject")} type="text" required maxLength={255} className={inputClass} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Category" name="category" error={errors.category}>
          <select {...field("category")} defaultValue={values.category ?? ""} required className={inputClass}>
            <option value="" disabled>
              Choose a category
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority" name="priority" error={errors.priority}>
          <select {...field("priority")} defaultValue={values.priority ?? "Medium"} required className={inputClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description" name="description" error={errors.description}>
        <textarea
          {...field("description")}
          rows={6}
          required
          placeholder="What happened? What did you expect? Steps to reproduce, if any."
          className={inputClass}
        />
      </Field>

      {/* Honeypot: hidden from people and screen readers, but bots that fill
          every field will fill this one, and the server drops those. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} />}

      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending && (
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        {pending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-zinc-800 dark:text-zinc-200"
      >
        {label}
      </label>
      {children}
      {error && (
        <p id={`${name}-error`} className="mt-1.5 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
