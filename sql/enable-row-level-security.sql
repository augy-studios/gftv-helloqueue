-- HelloQueue: turn on row-level security for every table, with no policies
-- (deny all).
--
-- Why the app keeps working: the API on Vercel and the Telegram bot reach
-- Supabase only with the service_role key (SUPABASE_SERVICE_KEY), and the
-- service_role bypasses row-level security. Nothing they do changes.
--
-- What it stops: with row-level security on and no policies, nothing else can
-- read or write these tables. The anon key, signed-in Supabase users and the
-- public REST API (/rest/v1/...) get no rows back, and their writes are
-- refused.
--
-- How to run it: paste the whole file into the Supabase SQL editor and press
-- Run. It runs in one transaction, so either every table gets row-level
-- security or none does. It's safe to run again: turning row-level security
-- on for a table that already has it changes nothing and raises no error.
--
-- It covers every table in schema.sql. The gftvhello_* tables belong to the
-- shared HelloSuite sign-in system, so they're left alone here. When a table
-- is added to schema.sql, add it here too.
--
-- To undo it for one table: alter table public.<table> disable row level security;

begin;

alter table public.gftvqueue_events               enable row level security;
alter table public.gftvqueue_event_editors        enable row level security;
alter table public.gftvqueue_queues               enable row level security;
alter table public.gftvqueue_queue_permissions    enable row level security;
alter table public.gftvqueue_entries              enable row level security;
alter table public.gftvqueue_entry_tokens         enable row level security;
alter table public.gftvqueue_telegram_links       enable row level security;
alter table public.gftvqueue_telegram_otps        enable row level security;
alter table public.gftvqueue_attendee_login_codes enable row level security;
alter table public.gftvqueue_attendee_sessions    enable row level security;

commit;

-- The check. The SQL editor shows this result: one row per gftvqueue_ table,
-- and every row should read rls_enabled = true and policies = 0.
-- A row with rls_enabled = false is a table that's missing from schema.sql
-- and this script. A row with policies above 0 has a policy that lets someone
-- in, so that table isn't deny-all.
select c.relname            as table_name,
       c.relrowsecurity     as rls_enabled,
       count(p.policyname)  as policies
from pg_class c
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and c.relname like 'gftvqueue\_%'
group by c.relname, c.relrowsecurity
order by c.relname;
