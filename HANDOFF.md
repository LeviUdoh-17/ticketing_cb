# Handoff: Ticket Submission App → Zoho Desk

## What we're building

A public-facing ticket submission web app that several of our other platforms/systems will send users to. When a user submits the form, the app creates a ticket in **Zoho Desk** under the **Technical** department. Our developers (2 for now) handle tickets inside Zoho Desk itself.

## Decisions already made

- **Zoho Desk is the source of truth.** We do NOT keep our own ticket database for now.
- **Developers work inside Zoho Desk** (agent accounts, assignment, custom statuses, Status View for a board-like view). No custom internal dashboard yet.
- **All Zoho API calls happen server-side only.** Credentials never reach the browser.
- **One app serves multiple source platforms.** Every ticket records which platform it came from.
- **v1 is submit-only.** Users get a ticket number and email updates; they can't see ticket status in this app. Showing status would need a read path (Desk API list/get by contact email, or a Zoho webhook into the app).
- Possible later additions (NOT in scope yet): attachments, Zoho webhooks, a ticket status page for users, a custom dev dashboard, our own DB, a public REST API for other systems.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Zod for validation
- Resend (optional, see "Confirmation email" below)
- Cloudflare Turnstile for spam protection (can come after the MVP works)

## Manual Zoho setup (human does this, not Claude Code)

1. In Zoho Desk settings, create the **Technical** department.
2. Create custom ticket statuses, e.g. New → Triaged → In Progress → In Review → Resolved.
3. Create a custom ticket field named **Source** (dropdown or text). Note its API name (likely `cf_source`).
4. Note your **orgId**: Desk Setup → Developer Space → API.
5. Note your **data center**: the domain you log in on (`zoho.com`, `zoho.eu`, `zoho.in`, etc.). Use it consistently for both `desk.zoho.*` and `accounts.zoho.*`.
6. Sign in with **one of the two developer accounts**, then go to the Zoho API Console (`api-console.zoho.<dc>`) and create a **Self Client**.
   - **Decision (cost):** we use 2 paid Desk seats, one per developer, and no separate service user.
   - **Trade-off:** the refresh token acts as whoever authorized it, so that developer shows as the creator on every ticket. The submitter is still the ticket's contact, so replies go to them.
   - **If that developer leaves, is deactivated, or revokes the app:** form submissions start failing. Redo steps 6–7 with the other developer's account and update `.env.local`.
   - **Later:** if a seat becomes affordable, switch to a dedicated service user (e.g. `tickets-bot@...`). Only `.env.local` changes.
7. Generate a grant code with the minimal scopes `Desk.tickets.CREATE,Desk.tickets.READ,Desk.contacts.CREATE,Desk.contacts.READ,Desk.basic.READ` (no `.ALL`), then exchange it immediately (it expires in minutes) for a **refresh token**:
   ```
   POST https://accounts.zoho.<dc>/oauth/v2/token
     ?grant_type=authorization_code&client_id=...&client_secret=...&code=...
   ```
8. Get the Technical department ID: `GET https://desk.zoho.<dc>/api/v1/departments` with headers `Authorization: Zoho-oauthtoken <access_token>` and `orgId: <orgId>`.

## Shared Zoho org: settle before the first ticket

The Zoho Desk org is shared with other teams, so:

- **Department:** confirm no other team files into Technical. If it's shared, create a dedicated product-dev department and point `ZOHO_TECH_DEPARTMENT_ID` at it.
- **`cf_source` is org-wide.** As a text field it needs nothing. As a dropdown, adding "Career Bridge" changes the dropdown for every department: tell the other teams, or scope the layout to our department.
- **Existing automations:** check org-level workflow rules, assignment rules, SLAs and auto-replies that could fire on our tickets.
- **Task 10:** leaning towards Zoho's automatic acknowledgement (simplest, no extra service).

### First test ticket checklist

- [ ] `ZOHO_DC` matches the domain you log in on, and is used for both `accounts.zoho.<dc>` and `desk.zoho.<dc>`
- [ ] Submit one throwaway ticket and confirm the department, priority, channel (Web) and Source are correct, and that the contact is the form submitter (not the developer whose account is connected). If using Zoho's acknowledgement email, confirm the submitter receives it, because some notification rules skip tickets created by agents.
- [ ] Delete the test ticket afterwards

## Environment variables (`.env.local`, never commit)

```
ZOHO_DC=com                    # or eu, in, com.au, etc.
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_ORG_ID=
ZOHO_TECH_DEPARTMENT_ID=
ZOHO_SOURCE_FIELD=cf_source    # API name of the custom Source field

# Rate-limit store: required on serverless hosts, optional on a single server
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TICKETS_DAILY_LIMIT=200        # cap across the whole form

# Optional
RESEND_API_KEY=
```

## Security model

The Server Action is a public POST endpoint (callable without the form), so every check runs on the server, cheapest first:

1. **Honeypot** field `website`: hidden from people; bots that fill it are rejected.
2. **Field validation** (Zod).
3. **Rate limits** (`lib/rate-limit.ts`): 5/hour per IP, 3/hour per email (stops the form being used to flood someone's inbox with Zoho emails), `TICKETS_DAILY_LIMIT`/day overall (protects the shared Zoho quota). IPs and emails are hashed before storage. Fails open if Upstash is down.
4. **Zoho call**, with timeouts. Raw Zoho errors are logged, never returned.

**Cloudflare Turnstile is parked on the `feature/turnstile` branch** (removed from `main` on 2026-11-19). On the live site every challenge failed with client errors 300010/300030 on all devices tested, and 0 siteverify calls reached Cloudflare. Before merging it back: find the cause (check the widget settings and that Vercel's Production `TURNSTILE_SECRET_KEY` is the real secret, not the `1x000…` test one), and add the Cloudflare domains back to the CSP. Until then the form relies on the honeypot and rate limits, so **Upstash must be connected on Vercel** or the rate limits don't hold.

Also: built-in Server Action origin check (CSRF), 100kb request body limit, security headers + CSP in `next.config.ts` (page can't be embedded in iframes; change `frame-ancestors` if a platform ever needs to embed it), HTML-escaped descriptions.

Client IP comes from `x-real-ip` / `x-forwarded-for`, which the host must set (Vercel, Netlify, Render and standard reverse proxies do).

## File structure

```
app/
  page.tsx                 # the form page
  actions/create-ticket.ts # Server Action: honeypot → validate → rate limit → Zoho
components/
  TicketForm.tsx           # client component, Tailwind-styled
lib/
  env.ts                   # validates env vars with Zod
  rate-limit.ts            # per-IP / per-email / daily limits (Upstash or in-memory)
  zoho/auth.ts             # getAccessToken() with in-memory cache
  zoho/tickets.ts          # createTicket()
  validation.ts            # shared Zod schema + source allowlist
```

## Implementation tasks

1. ✅ Scaffold Next.js (TypeScript, Tailwind, App Router, ESLint) + `zod`.
2. ✅ `lib/env.ts`: validate env vars with Zod, fail fast with a clear error.
3. ✅ `lib/zoho/auth.ts`: `getAccessToken()` using the refresh token, cached in module memory (refreshed ~5 min early), typed error on failure.
4. ✅ `lib/zoho/tickets.ts`: `createTicket(input)` → `POST /api/v1/tickets`, returns `{ id, ticketNumber }`, clears token cache and retries once on 401.
5. ✅ `lib/validation.ts`: Zod schema for name, email, subject, description, priority (Low/Medium/High/Urgent), category, source.
6. ✅ `components/TicketForm.tsx`: accessible form, inline errors, pending state, success state with ticket number, `useActionState`.
7. ✅ `app/actions/create-ticket.ts`: validate, call `createTicket`, return field errors or `{ ticketNumber }`. Never return raw Zoho errors; log server-side.
8. ✅ Source platform: a visible **Platform** dropdown on the form (allowlist in `lib/validation.ts`, default **Career Bridge**). `?source=<slug>` preselects it. Zoho's Source field receives the label (e.g. `Career Bridge`).
9. 🟡 Spam protection: rate limits + honeypot + security headers (see "Security model"). Turnstile is parked on `feature/turnstile` until its live failures are fixed. Remaining: Upstash on Vercel. **Required before launch:** the public form writes into a paid shared org, so spam would flood other teams' queues and use up the shared API quota.
10. ⬜ Confirmation email: EITHER Zoho Desk's automatic acknowledgement (or a Zoho Workflow email alert on ticket create) OR a branded Resend email (then disable Zoho's). Never both. Leaning: Zoho.

## Gotchas

- **Data center mismatch** is the most common first bug. The `.com`/`.eu`/`.in` domain must match the account for both the accounts and desk APIs.
- **Grant codes from the Self Client expire within minutes.** Exchange them right away.
- **Never call Zoho from the client.** The form talks only to the Server Action.
- **Serverless instances each hold their own token cache.** Fine at our volume. If we hit Zoho's token rate limits, move the cache to Redis/KV.
- **Zoho Desk API access and limits depend on the plan edition.** Confirm our plan allows API use.
- **Category and Priority values must exist in Zoho** (in our department's layout): `CATEGORIES` and `PRIORITIES` in `lib/validation.ts` are sent as-is. Zoho has no **Urgent** priority by default, so add it.
- On **Zoho One**, the account that authorized the Self Client needs the Desk app assigned and must be an agent in our department.
- If the Source field is a **dropdown** in Zoho, every label in `SOURCE_LABELS` (`lib/validation.ts`) must exist as an option there, or ticket creation fails.

## Definition of done (MVP)

Submitting the form locally creates a real ticket in the Technical department in Zoho Desk, with the correct source value, and the user sees the ticket number on screen.

✅ **Met on 2026-11-14.** Local test ticket landed in **Product Development** (ID `95278000005945029`, EU data center) with the correct category, priority, channel, Source and contact.

Open after the test:
- No acknowledgement email reached the submitter (the test used an agent's own email). Retest with a non-agent address. If Zoho doesn't acknowledge API-created tickets, use a Workflow rule (on Create, Product Development) that emails the contact, which also completes task 10.
- No assignment email: check agent notifications for the department (self-assignment never notifies).
