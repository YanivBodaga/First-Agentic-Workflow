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

-- Both tables are only ever accessed via the service-role key (lib/supabase/admin.ts), which
-- bypasses RLS. Enabling RLS with no policies locks out anon/authenticated entirely.
alter table users enable row level security;
alter table execution_log enable row level security;

-- The insert trigger that fires the webhook is NOT created here. The `supabase_functions` schema
-- and its `http_request` function are provisioned lazily by the Dashboard's Database Webhooks UI
-- (Database -> Webhooks), which is also where the trigger itself is created and managed -- running
-- `create trigger ... execute function supabase_functions.http_request(...)` directly via the SQL
-- editor fails with "schema supabase_functions does not exist" on a project where that UI has never
-- been used. Configure the webhook there instead:
--   Table: users, Events: Insert, Type: HTTP Request, Method: POST,
--   URL: https://first-agentic-workflow.vercel.app/api/events/user-created,
--   Headers: Content-Type: application/json, Timeout: 5000ms
