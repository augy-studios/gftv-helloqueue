-- HelloQueue Database Schema
-- Run this in your Supabase SQL editor
-- Assumes gftvhello_users, gftvhello_sessions, gftvhello_backup_codes,
-- gftvhello_totp_challenges, gftvhello_trusted_devices already exist.

-- ─────────────────────────────────────────
-- EVENTS
-- ─────────────────────────────────────────
create table public.gftvqueue_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  venue text null,
  event_date date null,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  access_code char(8) not null unique,         -- 8-char code for URL: queue.gftv.asia/{access_code}/...
  created_by uuid not null references public.gftvhello_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
) tablespace pg_default;

create index idx_gftvqueue_events_access_code on public.gftvqueue_events using btree (access_code);
create index idx_gftvqueue_events_created_by  on public.gftvqueue_events using btree (created_by);

-- ─────────────────────────────────────────
-- EVENT EDITORS  (admin assigns editors to events)
-- ─────────────────────────────────────────
create table public.gftvqueue_event_editors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.gftvqueue_events(id) on delete cascade,
  user_id  uuid not null references public.gftvhello_users(id) on delete cascade,
  assigned_by uuid not null references public.gftvhello_users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  constraint uq_event_editor unique (event_id, user_id)
) tablespace pg_default;

create index idx_gftvqueue_event_editors_event on public.gftvqueue_event_editors using btree (event_id);
create index idx_gftvqueue_event_editors_user  on public.gftvqueue_event_editors using btree (user_id);

-- ─────────────────────────────────────────
-- QUEUES
-- ─────────────────────────────────────────
create table public.gftvqueue_queues (
  id uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.gftvqueue_events(id) on delete cascade,
  name text not null,
  description text null,
  status text not null default 'closed' check (status in ('open','closed')),
  access_code char(8) not null unique,         -- queue.gftv.asia/{event_code}/{queue_code}
  max_serving int not null default 30,
  created_by  uuid not null references public.gftvhello_users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
) tablespace pg_default;

create index idx_gftvqueue_queues_event      on public.gftvqueue_queues using btree (event_id);
create index idx_gftvqueue_queues_access_code on public.gftvqueue_queues using btree (access_code);

-- ─────────────────────────────────────────
-- QUEUE PERMISSIONS
-- queue creator = is_queue_admin true; can grant/revoke other editors
-- ─────────────────────────────────────────
create table public.gftvqueue_queue_permissions (
  id uuid primary key default gen_random_uuid(),
  queue_id      uuid not null references public.gftvqueue_queues(id) on delete cascade,
  user_id       uuid not null references public.gftvhello_users(id) on delete cascade,
  is_queue_admin boolean not null default false,  -- queue creator / explicitly promoted
  granted_by    uuid not null references public.gftvhello_users(id) on delete restrict,
  granted_at    timestamptz not null default now(),
  constraint uq_queue_permission unique (queue_id, user_id)
) tablespace pg_default;

create index idx_gftvqueue_qperms_queue on public.gftvqueue_queue_permissions using btree (queue_id);
create index idx_gftvqueue_qperms_user  on public.gftvqueue_queue_permissions using btree (user_id);

-- ─────────────────────────────────────────
-- QUEUE ENTRIES (the actual queue)
-- ─────────────────────────────────────────
create table public.gftvqueue_entries (
  id uuid primary key default gen_random_uuid(),
  queue_id       uuid not null references public.gftvqueue_queues(id) on delete cascade,
  telegram_user_id bigint not null,            -- Telegram chat_id (integer from Telegram API)
  telegram_username text null,
  display_name   text not null,
  queue_number   int not null,
  status text not null default 'waiting'
    check (status in ('waiting','serving','missed','completed')),
  notify_serving boolean not null default true,
  notify_next    boolean not null default true,
  joined_at      timestamptz not null default now(),
  called_at      timestamptz null,
  entered_at     timestamptz null,
  completed_at   timestamptz null,
  constraint uq_queue_entry unique (queue_id, queue_number)
) tablespace pg_default;

create index idx_gftvqueue_entries_queue  on public.gftvqueue_entries using btree (queue_id);
create index idx_gftvqueue_entries_tg     on public.gftvqueue_entries using btree (telegram_user_id);
create index idx_gftvqueue_entries_status on public.gftvqueue_entries using btree (status);

-- ─────────────────────────────────────────
-- ENTRY TOKENS (animated QR one-time tokens)
-- single-use, no expiry until used
-- ─────────────────────────────────────────
create table public.gftvqueue_entry_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  entry_id uuid not null references public.gftvqueue_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at    timestamptz null                  -- null = not yet used
) tablespace pg_default;

create index idx_gftvqueue_tokens_token on public.gftvqueue_entry_tokens using btree (token);
create index idx_gftvqueue_tokens_entry on public.gftvqueue_entry_tokens using btree (entry_id);

-- ─────────────────────────────────────────
-- TELEGRAM LINKS
-- maps Telegram chat_id → gftvhello_users.id
-- ─────────────────────────────────────────
create table public.gftvqueue_telegram_links (
  id uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references public.gftvhello_users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_username text null,
  linked_at       timestamptz not null default now()
) tablespace pg_default;

create index idx_gftvqueue_tglinks_user on public.gftvqueue_telegram_links using btree (user_id);
create index idx_gftvqueue_tglinks_tg   on public.gftvqueue_telegram_links using btree (telegram_user_id);

-- ─────────────────────────────────────────
-- TELEGRAM LINK OTPs  (web → bot verification)
-- ─────────────────────────────────────────
create table public.gftvqueue_telegram_otps (
  id uuid primary key default gen_random_uuid(),
  otp_code   char(6) not null unique,           -- 6-digit code user enters on web
  user_id    uuid not null references public.gftvhello_users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at    timestamptz null
) tablespace pg_default;

create index idx_gftvqueue_otps_code    on public.gftvqueue_telegram_otps using btree (otp_code);
create index idx_gftvqueue_otps_user    on public.gftvqueue_telegram_otps using btree (user_id);

-- ─────────────────────────────────────────
-- ATTENDEE LOGIN CODES  (queue page → bot sign-in, no account needed)
-- POST /api/auth/attendee-login makes a code; the bot (/attend or the
-- attend_ deep link) sets used_at and session_token; the page polls with GET,
-- which hands session_token out once and then sets it back to null.
-- Written from api/auth/attendee-login.js, api/telegram/webhook.js and
-- bot/index.js: this table was in use before it was in this file.
-- ─────────────────────────────────────────
create table public.gftvqueue_attendee_login_codes (
  id uuid primary key default gen_random_uuid(),
  code          char(6) not null unique,       -- randomCode(6) in api/_auth.js; char(6) inferred, like otp_code
  used_at       timestamptz null,              -- null = the bot hasn't confirmed it yet
  expires_at    timestamptz not null default (now() + interval '10 minutes'),  -- the code never sets it: default inferred, like the OTPs
  session_token text null,                     -- copy of gftvqueue_attendee_sessions.token; null again after the first poll
  created_at    timestamptz not null default now()   -- inferred: the code doesn't read it
) tablespace pg_default;

-- No foreign key on session_token: the code never joins on it, and the bot
-- deletes a Telegram user's old sessions while old codes may still hold them.
create index idx_gftvqueue_login_codes_code on public.gftvqueue_attendee_login_codes using btree (code);

-- ─────────────────────────────────────────
-- ATTENDEE SESSIONS  (Telegram sign-in without an account)
-- The bot inserts one per sign-in after deleting the Telegram user's earlier
-- ones; api/_auth.js looks the bearer token up here when it isn't an account
-- session. Written from api/_auth.js, api/queues/[queueId]/join.js,
-- api/telegram/webhook.js and bot/index.js: this table was in use before it
-- was in this file.
-- ─────────────────────────────────────────
create table public.gftvqueue_attendee_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),  -- the insert sends no token and reads it back; format inferred, like entry tokens
  telegram_user_id  bigint not null,           -- Telegram chat_id (integer from Telegram API)
  telegram_username text null,
  display_name      text not null,             -- the bot always sends one ('Attendee' at worst)
  expires_at timestamptz not null default (now() + interval '30 days'),  -- the code never sets it: 30 days inferred
  created_at timestamptz not null default now()   -- inferred: the code doesn't read it
) tablespace pg_default;

-- telegram_user_id is not unique: the bot keeps one session per Telegram user
-- by deleting before it inserts.
create index idx_gftvqueue_att_sessions_token on public.gftvqueue_attendee_sessions using btree (token);
create index idx_gftvqueue_att_sessions_tg    on public.gftvqueue_attendee_sessions using btree (telegram_user_id);

-- ─────────────────────────────────────────
-- UPDATED_AT trigger helper
-- ─────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_gftvqueue_events_updated
  before update on public.gftvqueue_events
  for each row execute function public.set_updated_at();

create trigger trg_gftvqueue_queues_updated
  before update on public.gftvqueue_queues
  for each row execute function public.set_updated_at();