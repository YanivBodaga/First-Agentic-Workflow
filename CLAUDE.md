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

## Current status / next steps (updated 2026-07-05)

Read this first when resuming work — it says exactly where things stand and what to do next.

**Done (Phase 0, partial):**
- Next.js 16 app scaffolded, builds and lints clean.
- Git repo initialized and pushed to `https://github.com/YanivBodaga/First-Agentic-Workflow` (branch `main`).
- Full approved plan copied into `specs/001-automation-exercise-plan.md` (also still at
  `~/.claude/plans/goofy-swimming-crystal.md` on this machine, but the repo copy is the durable source of
  truth).
- Repo intentionally lives at a local path (`C:\Users\yaniv\projects\automation-exercise`), not inside a
  cloud-synced folder — see "Project location" below for why.

**Not done yet, blocking further progress:**
1. User has a Vercel account and a Supabase account, but the Supabase project and its API keys have not been
   captured yet (waiting on: Project URL, anon key, service_role key from Project Settings → API).
2. `.env.local` doesn't exist yet — create it from `.env.example` once the Supabase keys above are in hand.
3. App hasn't been deployed to Vercel yet (import the GitHub repo at vercel.com/new, or `npx vercel`) — needed
   before Phase 1's DB trigger can be pointed at a real URL.
4. Docker and ngrok are not installed on this machine — not needed until Phase 3, no rush.

**Immediate next step**: get the 3 Supabase values from the user, write `.env.local`, deploy to Vercel, then
start Phase 1 (`supabase/migrations/0001_users_and_execution_log.sql` per the plan doc).

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
- `docker compose -f n8n/docker-compose.yml up` — start local n8n (added in Phase 3)
- `ngrok http 5678` — expose local n8n publicly for the Vercel-deployed app to reach (Phase 3+)
