# Spec: End-to-End Automation Exercise

## Objective

The curriculum's mandatory deliverable: prove out a real automation slice of a product — trigger → signed
webhook → external workflow action → status → execution log — including the reliability concerns (retries,
idempotency) and observability that make automations production-worthy rather than a toy demo.

Concretely: a Next.js API endpoint emits a `user.created` event, forwards it as a signed webhook to an n8n
workflow, which appends a row to a Google Sheet and reports a status back; the app then persists an execution
log row in Supabase.

## User Stories & Acceptance Criteria

- **As a developer**, when I create a user (via the app or a direct POST to trigger the event), the system
  emits a `user.created` event.
  - AC: The triggering request returns immediately; the webhook dispatch, n8n round-trip, and execution log
    write all happen asynchronously in the background (fire-and-forget from the caller's perspective).
- **As the endpoint**, when an event is emitted, it sends a webhook to n8n containing the event payload and an
  HMAC-SHA256 signature computed over the payload with a shared secret.
  - AC: n8n's workflow verifies the signature and rejects the request if it's missing or invalid.
- **As the n8n workflow**, when it receives a validly-signed webhook, it appends one row to a configured
  Google Sheet (event type, user id/email, timestamp) and returns a status (`success` / `failure`) in its
  response.
  - AC: Triggering the event results in exactly one new row in the Google Sheet.
- **As the app**, after the webhook call resolves (or exhausts retries), it writes one `execution_log` row:
  event type, event id, status, attempt count, response summary, timestamps.
  - AC: After triggering the event, querying `execution_log` shows exactly one row for that event id with the
    correct status.

## Constraints & Edge Cases

- **Idempotency**: replaying the same `event_id` must not produce a second Google Sheet row or a second
  `execution_log` row. Enforce via a unique constraint on `event_id` in `execution_log`, checked before
  sending the webhook.
- **Retries**: if the webhook call to n8n fails or times out, retry up to 3 attempts total with exponential
  backoff (1s, 2s, 4s), then mark as failed. Log every attempt count in `execution_log`.
- **Secrets**: the webhook signing secret and any Google credentials live in env vars / n8n credential store,
  never committed.
- **Downstream failure**: if the Google Sheets step fails inside n8n, the workflow should still return a
  `failure` status (not just time out) so the app can log it accurately.
- **Out of scope for this exercise**: multiple event types beyond `user.created`, a real message queue,
  event ordering guarantees. Structure the code so a queue could be introduced later without a rewrite, but
  don't build one now.

## Observability

- Structured log line at each stage: event received, webhook attempt N sent, webhook response received,
  execution log written.
- `execution_log` table: `id`, `event_id` (unique), `event_type`, `status`, `attempt_count`,
  `response_summary`, `created_at`, `updated_at`.
- A minimal way to inspect execution logs manually (e.g. a `GET /api/execution-logs` route) to support
  `/verify` — actually watching a triggered event land as a Sheet row and a log row, not just trusting tests.

## Decisions

- **Dispatch mode**: async / fire-and-forget.
- **Retry policy**: 3 attempts total, exponential backoff (1s, 2s, 4s).
- **n8n hosting**: self-hosted via Docker.
