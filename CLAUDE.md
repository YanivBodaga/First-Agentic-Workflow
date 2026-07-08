# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This repo is the practical project for a full-stack "developer + AI" curriculum. It is a Next.js + Supabase
app. The core deliverable is the curriculum's mandatory **End-to-End Automation exercise**: an endpoint that
emits a domain event, forwards it to n8n via a signed webhook, has n8n perform a real action (append a row to
a Google Sheet), and persists an execution log back in the app's database. Everything else in the app (auth,
data models, pages) exists to give that exercise a real context to live in, per the curriculum's Module 4
full-stack refresher.

The Next.js app is scaffolded (App Router, TypeScript, no Tailwind). Supabase project and n8n instance are not
yet set up — see the phased plan in `specs/001-automation-exercise.md` and the Stack section below.

## Current status / next steps (updated 2026-07-09)

Read this first when resuming work — it says exactly where things stand and what to do next.

**Done (Phase 0, complete):**
- Next.js 16 app scaffolded, builds and lints clean.
- Git repo initialized and pushed to `https://github.com/YanivBodaga/First-Agentic-Workflow` (branch `main`).
- Full approved plan copied into `specs/001-automation-exercise-plan.md` (also still at
  `~/.claude/plans/goofy-swimming-crystal.md` on this machine, but the repo copy is the durable source of
  truth).
- Repo intentionally lives at a local path (`C:\Users\yaniv\projects\automation-exercise`), not inside a
  cloud-synced folder — see "Project location" below for why.
- Supabase project created (project ref `pipuqvgclmibhoesgtla`); `.env.local` written with
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (git-ignored).
- App deployed to Vercel via dashboard import. **Stable production URL: `https://first-agentic-workflow.vercel.app`**
  (this is the one to use for the DB trigger — not the per-deployment `*-<hash>-bodaga.vercel.app` URL, which
  changes on every push). The same 3 Supabase env vars were also set in Vercel's project settings.

**Done (Phase 1, complete):**
- `supabase/migrations/0001_users_and_execution_log.sql`: `users` and `execution_log` tables created, both with
  RLS enabled and zero policies (intentional — both tables are only ever touched via the service-role key in
  `lib/supabase/admin.ts`, which bypasses RLS; no client-facing access needed). Applied directly via the
  Supabase SQL editor (hosted project, no local Supabase CLI installed).
- `lib/supabase/admin.ts` added: server-only service-role client (`@supabase/supabase-js` + `server-only`
  packages installed).
- The `user.created` trigger was **not** created via raw SQL — `create trigger ... execute function
  supabase_functions.http_request(...)` fails with `schema "supabase_functions" does not exist` until the
  Database Webhooks feature has been enabled at least once. Instead: enabled **Integrations → Database
  Webhooks** (which also required enabling the **pg_net** extension first, under Database → Extensions), then
  created the webhook itself through that UI: table `users`, event `Insert`, HTTP POST to
  `https://first-agentic-workflow.vercel.app/api/events/user-created`, header `Content-Type: application/json`,
  timeout `5000`ms. The migration file documents this in a comment instead of containing the `create trigger`
  statement.
- `npm run build` passes clean with the new files.
- Committed as `d636ecd "first phase"`.

**Done (Phase 2, complete):**
- `lib/events/types.ts` (`UserInsertWebhookPayload`, `UserCreatedEvent` — the user's row `id` doubles as the
  idempotency key since `user.created` only ever fires once per user), `lib/logging/logger.ts` (structured JSON
  logs, always keyed by `eventId`), `lib/execution-log/repository.ts` (`insertPendingExecutionLog` via
  `upsert(..., { onConflict: "event_id", ignoreDuplicates: true })` — no row returned means duplicate delivery;
  `finalizeExecutionLog`), `lib/events/dispatch.ts` (`dispatchUserCreatedEvent`, with a **stubbed** `sendToN8n`
  that always returns success — real signing/retry/fetch comes in Phase 4).
- `POST /api/events/user-created` (the receiver Supabase's webhook calls): validates the payload shape, then
  uses `after()` to run `dispatchUserCreatedEvent` post-response, returning `202` immediately.
- `POST /api/users` (stand-in for a real signup flow — inserting a row here is what fires the webhook) and
  `GET /api/execution-logs` (manual verification endpoint).
- `/code-review` run before commit (see workflow above) surfaced 4 findings; 3 were fixed (dispatch.ts's initial
  `insertPendingExecutionLog` and the `finalizeExecutionLog` call are now each wrapped in their own try/catch so
  a Supabase hiccup is logged instead of becoming a silent unhandled rejection inside `after()`; the receiver
  route now validates `payload.record.id` exists and returns `400` instead of throwing on malformed input;
  `/api/users` returns `409` with a clean message on a duplicate email instead of leaking the raw Postgres
  error). **Known, deliberately deferred**: `/api/events/user-created` has no verification that a request
  actually came from Supabase (no shared-secret header configured on the Database Webhook) — anyone who
  discovers the URL could POST a fabricated `user.created` event. Out of scope for Phase 2 per the plan (the
  plan only calls for signing the *outbound* app→n8n call); revisit alongside Phase 6's `/security-review` pass.
- Verified locally: `npm run build`/`lint` clean; simulated the Supabase webhook payload directly against
  `/api/events/user-created` (Supabase can't reach `localhost`, so this is the only way to test the dispatch
  path pre-deploy) — confirmed a `success` `execution_log` row lands, a replayed `event_id` does not create a
  duplicate row, a malformed payload returns `400`, and a duplicate email on `POST /api/users` returns `409`.
- Deployed to Vercel (push to `main`, commit `dc3b5f5`) and **verified against the real Supabase trigger**:
  `POST https://first-agentic-workflow.vercel.app/api/users` with a fresh email, then `GET
  https://first-agentic-workflow.vercel.app/api/execution-logs` showed a matching `event_id` (the new user's
  row `id`) with `status: "success"` — confirming the full real chain (Postgres insert → Supabase Database
  Webhook → `/api/events/user-created` → `after()` dispatch → idempotent `execution_log` write) works in
  production, not just in the local simulation.

**Done (Phase 3, complete):**
- Docker Desktop installed (Windows, WSL2 backend). `n8n/docker-compose.yml` added: single `n8n` service
  (`n8nio/n8n` image), port `5678`, `N8N_BASIC_AUTH_*` + `N8N_ENCRYPTION_KEY` sourced from `n8n/.env`
  (git-ignored, generated values), named volume `n8n_data` for persistence. Run via `docker compose --env-file
  n8n/.env -f n8n/docker-compose.yml up -d` (note the explicit `--env-file`: Compose's default `.env` lookup is
  the current working directory, not the directory next to `-f`'s target).
- n8n's own first-run owner-account setup (separate from the `N8N_BASIC_AUTH_*` instance-level gate) completed
  in-browser at `http://localhost:5678`.
- Minimal workflow `user-created-echo` built in the n8n UI: `Webhook` node (`POST /webhook/user-created`,
  Respond = "Using 'Respond to Webhook' Node") → `Respond to Webhook` node (JSON `{"status": "success"}`, `200`).
  Published (this n8n version renamed "Activate" to "Publish"). Exported and committed as
  `n8n/workflows/user-created.json` per the plan's "manually exported snapshot after meaningful changes" policy.
- ngrok installed via `winget install ngrok.ngrok` (the winget package was outdated — `3.3.1` fails Cloudflare's
  minimum-agent-version check with `ERR_NGROK_121`; ran `ngrok update` to `3.39.9` to fix), authenticated with
  the user's free-tier authtoken (`ngrok config add-authtoken`).
- Verified: `curl -X POST http://localhost:5678/webhook/user-created` returns `{"status":"success"}` directly;
  the same call through the ngrok tunnel (`ngrok http 5678`) also returns `{"status":"success"}`, confirming the
  public tunnel correctly forwards to the local n8n container.
- `N8N_WEBHOOK_URL` set to the ngrok URL + `/webhook/user-created` in both `.env.local` and Vercel's Production
  environment. **Caveat, expected**: free-tier ngrok URLs are ephemeral — they change every time the `ngrok
  http 5678` process restarts, so this value needs updating (both places) each time a fresh tunnel is started
  for a new testing session (e.g. after a reboot). `sendToN8n` in `lib/events/dispatch.ts` is still the Phase 2
  stub and does not yet actually call `N8N_WEBHOOK_URL` — that wiring happens in Phase 4.

**Not done yet, blocking further progress:**
1. Session paused after Phase 3 (2026-07-09). Docker Desktop and/or the `ngrok http 5678` process were likely
   stopped (machine restart, terminal closed, etc.) since then, so the old ngrok URL currently in
   `N8N_WEBHOOK_URL` (both `.env.local` and Vercel) is almost certainly dead.

**Immediate next step**: **before starting Phase 4**, refresh the local n8n + ngrok setup:
1. Make sure Docker Desktop is running, then `docker compose --env-file n8n/.env -f n8n/docker-compose.yml up -d`
   (the `user-created-echo` workflow persists in the `n8n_data` volume and should still be published).
2. `ngrok http 5678`, grab the new `https://*.ngrok-free.dev` URL from its output (or `curl
   http://127.0.0.1:4040/api/tunnels`).
3. Update `N8N_WEBHOOK_URL` to `<new ngrok URL>/webhook/user-created` in both `.env.local` and Vercel's
   Production environment (Project Settings → Environments → Production).
4. Sanity-check with `curl -X POST <new ngrok URL>/webhook/user-created` → expect `{"status":"success"}`.

Then start **Phase 4** — replace the stubbed `sendToN8n` in `lib/events/dispatch.ts` with a
real implementation: `lib/webhook/sign.ts` (HMAC-SHA256 over the exact raw JSON string sent, using a
`WEBHOOK_SIGNING_SECRET` env var — not yet set in `.env.local`/Vercel, needs generating), `lib/webhook/retry.ts`
(retry only on network error/timeout/5xx, not on a 4xx like a bad signature), and wiring `dispatch.ts` to
actually `fetch(N8N_WEBHOOK_URL, ...)` with a 5s `AbortController` timeout and the signed headers
(`X-Webhook-Signature`, `X-Event-Id`). Note the n8n workflow itself does not verify any signature yet (the
`user-created-echo` workflow just echoes success unconditionally) — that verification step is Phase 5, so
Phase 4's real-call path can be tested end-to-end (a genuine HTTP call reaching n8n through the ngrok tunnel)
before signature checking is added on the receiving side.

## Mandatory workflow: Spec → Plan → Jira tasks → Incremental implementation

This is not optional process ceremony — it's the explicit methodology this project is meant to practice. Follow
it for every non-trivial feature, including the automation exercise itself:

1. **Spec first.** Before planning or coding, write a short spec with:
   - **Objective** — the problem and the proposed solution
   - **User Stories & Acceptance Criteria** — scenarios and success metrics
   - **Constraints & Edge Cases**
   - **Observability** — what logs/metrics this feature needs
2. **Plan Mode, not direct edits.** Enter Plan Mode (Cursor or Claude Code) before touching files.
   - The agent should ask short clarifying questions before proposing a plan.
   - The plan must be staged (phases), listing expected files to change, risks, and a test approach.
   - The human edits the plan by hand until it's precise and enforceable.
   - No file changes happen until the plan is approved.
3. **Break the approved plan into small Jira tasks.**
4. **Implement incrementally**: one small change → test → self-review → commit. Never one big diff for a
   multi-phase plan.

### Where the built-in skills fit in this loop
- `/verify` — after implementing a step (especially the webhook → n8n → log flow), actually trigger the event
  and observe the execution log land, rather than trusting tests alone.
- `/run` — launch the app locally to drive a flow end-to-end before calling a step done.
- `/security-review` — required before considering the webhook/signature handling finished; secret handling
  and signature verification are exactly the kind of thing that needs an explicit pass.
- `/code-review` — before each commit in the incremental loop.
- `/simplify` — cleanup pass once a feature works, before the final commit.

## The automation exercise — acceptance criteria

Treat this as the spec for the core deliverable until a fuller spec doc is written:

1. A real `users` table with a Postgres trigger fires a `user.created` event by calling a Next.js API route
   (via Supabase's `supabase_functions.http_request`) whenever a row is inserted.
2. The endpoint forwards the event to n8n as a webhook, including a signature/secret so n8n can verify the
   sender.
3. The n8n workflow performs a real action — appends a row to a Google Sheet — and returns a status.
4. The app persists an **execution log** row in Supabase: event type, status, timestamp, and the n8n response.

Non-functional requirements called out by the curriculum (design for these explicitly, don't bolt them on
later): **retries** on webhook delivery failure, **idempotency** (a re-delivered/duplicate event must not be
processed twice), **observability** (structured logging plus the execution log table).

## Stack

- **Web/API**: Next.js 16 (App Router, TypeScript), deployed to **Vercel**. Deployment isn't optional here —
  hosted Supabase's DB trigger must call a real public URL; it cannot reach `localhost`.
- **DB/Auth**: hosted Supabase (Postgres).
- **Automation engine**: n8n, self-hosted via Docker, run locally. Exposed via an **ngrok tunnel** whenever
  testing, since the Vercel-deployed app needs a public URL to reach it too.
- **Automation's real action target**: Google Sheets.

See `specs/001-automation-exercise.md` and the plan referenced there for the full phased breakdown, exact
schema, and the reasoning behind the Vercel/ngrok requirement.

## Project location

This project deliberately does **not** live inside a cloud-synced folder (e.g. Google Drive/OneDrive) — an
earlier attempt to develop inside a Drive-synced path corrupted `node_modules` during a bulk file move. Keep
this repo on a plain local disk path; use git/GitHub for backup and sharing instead of folder sync.

## Commands

- `npm run dev` — start the local dev server
- `npm run build` — production build (also used as a lint/type-check gate)
- `npm run lint` — ESLint
- `docker compose --env-file n8n/.env -f n8n/docker-compose.yml up -d` — start local n8n (added in Phase 3;
  the explicit `--env-file` matters — Compose's default `.env` lookup is the current working directory, not
  the directory next to `-f`'s target)
- `ngrok http 5678` — expose local n8n publicly for the Vercel-deployed app to reach (Phase 3+); copy the
  printed `https://*.ngrok-free.dev` URL + `/webhook/user-created` into `N8N_WEBHOOK_URL` in both `.env.local`
  and Vercel's Production env vars (free-tier URL changes every restart)
