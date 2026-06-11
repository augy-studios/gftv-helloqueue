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