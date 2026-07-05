# Approved Implementation Plan: End-to-End Automation Exercise

This is the phased plan approved via Claude Code's Plan Mode for `001-automation-exercise.md`. Copied into
the repo (rather than left only in the local `~/.claude/plans` folder) so it survives across machines/sessions
and isn't lost if that local plan file is cleaned up.

## Context

This is the mandatory capstone deliverable from the full-stack + AI curriculum (see `CLAUDE.md` and
`specs/001-automation-exercise.md`): a real users table triggers a signed webhook to a self-hosted n8n
workflow, which appends a row to a Google Sheet and reports a status back, which the app logs. The point of
the exercise is to practice the whole slice — trigger → webhook → external action → status → log — with the
reliability/observability concerns (retries, idempotency, structured logging) that make it more than a toy
demo.

### Key architecture decisions (already made, not being re-litigated)

- **Event source**: a real `users` table with a Postgres trigger — not a synthetic/manual event. Inserting a
  row is what fires `user.created`.
- **Supabase**: a hosted project (not local CLI), since the DB trigger needs to call a real HTTPS endpoint.
- **App deployment**: the Next.js app deploys to **Vercel**. This is required — the DB trigger runs inside
  hosted Supabase's infrastructure and cannot reach a local `localhost:3000`.
- **n8n**: self-hosted via Docker, run locally. Exposed to the internet via an **ngrok tunnel** whenever
  testing, since the Vercel-deployed app needs a public URL to reach it too.
- **Retries**: only for transient failures (timeout/network error/5xx). A deterministic failure like a bad
  signature (401) is not retried.
- **Dispatch**: async/fire-and-forget from the triggering request's perspective, implemented with Next.js
  `after()` (stable in Next 15+) — not a bare un-awaited promise, which serverless platforms (including
  Vercel) can silently kill after the response flushes.
- **Defaults adopted without a separate question** (cheap to change later): skip `zod`; 5s timeout per webhook
  attempt via `AbortController`; DB-webhook receiver responds `202`; n8n workflow edited in its UI and
  manually exported to a committed JSON snapshot after meaningful changes.

### Practical consequence worth remembering

Because the DB trigger points at a real deployed URL, testing the trigger path requires a deploy (`git push`
to `main`, which Vercel auto-deploys), not just local hot reload. The Supabase trigger must point at the
**production** Vercel URL (stable across deploys), not an ephemeral preview URL.

## Repo layout (target — not all created yet)

```
app/
  api/
    events/
      user-created/route.ts     # receives the Supabase DB-webhook call; 202 fast, then after() dispatch
    users/route.ts               # POST {email} -> insert into users (stand-in for real signup)
    execution-logs/route.ts      # GET, manual verification of logged executions
lib/
  supabase/
    admin.ts                     # service-role server client, server-only
  events/
    types.ts                     # UserCreatedEventPayload
    dispatch.ts                  # idempotency insert -> sign -> retry loop -> finalize log
  webhook/
    sign.ts                      # HMAC-SHA256 signing (Node crypto)
    retry.ts                     # withRetry(fn, backoffMs[]), retries transient errors only
  execution-log/
    repository.ts                # insertPending (ON CONFLICT DO NOTHING) / finalize
  logging/
    logger.ts                    # structured JSON log lines, always include event_id
supabase/
  migrations/
    0001_users_and_execution_log.sql   # users table, execution_log table, trigger + http_request function
n8n/
  docker-compose.yml
  workflows/
    user-created.json            # manual export snapshot, updated after each meaningful edit
.env.example
```

## Supabase schema (`0001_users_and_execution_log.sql`)

```sql
create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists execution_log (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null unique,
  event_type        text not null,
  status            text not null check (status in ('pending', 'success', 'failure')),
  attempt_count     integer not null default 0,
  response_summary  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_execution_log_event_type on execution_log (event_type);

-- Fires on every new user; calls the deployed app's endpoint (Supabase's built-in
-- supabase_functions.http_request, the same mechanism the Dashboard's "Database Webhooks" UI generates).
create trigger "user_created_webhook"
after insert on "public"."users"
for each row
execute function "supabase_functions"."http_request"(
  'https://<production-vercel-domain>/api/events/user-created',
  'POST',
  '{"Content-Type":"application/json"}',
  '{}',
  '5000'
);
```

Replace `<production-vercel-domain>` with the real domain once Phase 0's Vercel deploy exists.

**Idempotency**: before dispatching, `dispatch.ts` does
```sql
insert into execution_log (event_id, event_type, status, attempt_count)
values ($1, $2, 'pending', 0)
on conflict (event_id) do nothing
returning id;
```
No row returned ⇒ duplicate delivery ⇒ log and stop, no webhook/Sheet write.

## Webhook dispatch flow (precise)

```
INSERT INTO users(...)
  → Postgres trigger fires (async, Supabase-managed) → POST to deployed /api/events/user-created

POST /api/events/user-created  (Vercel)
  → after(() => dispatch(payload))
  → return 202 immediately

dispatch(payload)  [runs via after(), after the response is already sent]
  → log "event received" (event_id, event_type)
  → INSERT ... ON CONFLICT DO NOTHING → bail if duplicate
  → sign payload (HMAC-SHA256 over the exact raw JSON string, header X-Webhook-Signature + X-Event-Id)
  → withRetry(attempt => {
        log "webhook attempt N sent"
        fetch(N8N_WEBHOOK_URL /* ngrok URL */, { signed headers, body, 5s AbortController timeout })
        log "webhook response received"
        // only retry on: network error, timeout, 5xx. A 4xx is a final failure, no retry.
        return parsed n8n response { status, ... }
     })
  → UPDATE execution_log SET status, attempt_count, response_summary, updated_at (try/finally so an
    unexpected exception still finalizes as 'failure' rather than leaving the row 'pending' forever)
```

## n8n workflow

Nodes: **Webhook** (raw body enabled) → **Function node, verify HMAC-SHA256 signature** → **IF** valid/invalid
→ invalid: **Respond to Webhook** `401 {status:'failure', reason:'invalid signature'}` → valid: **Google
Sheets (Append)**, `Continue On Fail` enabled → branch on error output → **Respond to Webhook** `200
{status:'success'}` or `{status:'failure', reason:<error>}`.

`docker-compose.yml` runs n8n only (the app runs on Vercel, not containerized):
```yaml
services:
  n8n:
    image: n8nio/n8n
    ports: ["5678:5678"]
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_BASIC_AUTH_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_BASIC_AUTH_PASSWORD}
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
    volumes:
      - n8n_data:/home/node/.n8n
volumes:
  n8n_data:
```
Run `ngrok http 5678` when testing; set `N8N_WEBHOOK_URL` in Vercel's env vars to the current ngrok URL.

## Phased breakdown

**Phase 0 — Scaffold + deploy skeleton**
`create-next-app` (done), hosted Supabase project, `.env.example` (done), deploy to Vercel to get a stable
production URL, update `CLAUDE.md` Commands (done).

**Phase 1 — Schema + trigger**
Apply `0001_users_and_execution_log.sql` (with the real production URL in the trigger). Add
`lib/supabase/admin.ts`.

**Phase 2 — Receiver endpoint + execution_log write, n8n stubbed**
Add `lib/events/types.ts`, `lib/logging/logger.ts`, `lib/execution-log/repository.ts`, `lib/events/
dispatch.ts` with a **stubbed** `sendToN8n`, `POST /api/events/user-created` using `after()`, `POST
/api/users`, `GET /api/execution-logs`. Deploy.

**Phase 3 — n8n up locally + minimal echo workflow**
`docker compose up`, minimal workflow (Webhook → static success), `ngrok http 5678`, set `N8N_WEBHOOK_URL`.

**Phase 4 — Replace stub with real signing + retry + fetch**
Add `lib/webhook/sign.ts`, `lib/webhook/retry.ts` (transient-only retry), wire `dispatch.ts` for real n8n
calls.

**Phase 5 — Signature verification + real Google Sheets action**
Function-node signature check + IF branch; Google Sheets Append node with `Continue On Fail`; both
Respond-to-Webhook branches.

**Phase 6 — Idempotency proof + observability polish + sign-off**
Concurrent/duplicate `event_id` test, structured log audit, `/security-review`, full `/verify` pass, final
`CLAUDE.md` update.

## Verification summary

| Phase | Check |
|---|---|
| 0 | Vercel URL live |
| 1 | migration applies; unique `event_id` blocks duplicates |
| 2 | insert → trigger → 202 → log row via stub; replay is a no-op |
| 3 | direct curl to ngrok URL returns static success |
| 4 | real success case; forced-failure retry/backoff case (3 attempts, correct timing) |
| 5 | real Sheet row; signature tamper rejected; Sheets failure returns `failure` not a timeout |
| 6 | concurrent duplicate → exactly one Sheet row + one log row; `/security-review` and `/verify` pass |

## Critical files

- `supabase/migrations/0001_users_and_execution_log.sql`
- `app/api/events/user-created/route.ts`
- `app/api/users/route.ts`
- `lib/events/dispatch.ts`
- `lib/webhook/sign.ts`
- `lib/webhook/retry.ts`
- `n8n/docker-compose.yml`
