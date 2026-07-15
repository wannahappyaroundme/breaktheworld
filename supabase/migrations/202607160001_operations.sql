create type public.quest_event_type as enum (
  'CHARGE_RELEASED',
  'WEAPON_USED',
  'TARGET_DESTROYED'
);

create type public.analytics_event_type as enum (
  'visit',
  'first_hit',
  'first_destroy',
  'weapon_use',
  'target_finish_actions',
  'charge_release',
  'charge_cancel',
  'quest_complete',
  'share_complete'
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'operator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.quest_catalog (
  id text primary key check (id ~ '^[a-z0-9_]{3,64}$'),
  copy text not null check (char_length(copy) between 2 and 60 and position('—' in copy) = 0),
  event_type public.quest_event_type not null,
  target integer not null check (target between 1 and 100),
  active_from timestamptz,
  active_to timestamptz,
  enabled boolean not null default false,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  check (active_to is null or active_from is null or active_to > active_from)
);

create table public.feature_flags (
  key text primary key check (
    key in ('gamification_enabled', 'character_variants_enabled', 'analytics_enabled')
  ),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  event_type public.analytics_event_type not null,
  day_key date not null,
  install_hash text not null check (install_hash ~ '^[a-f0-9]{64}$'),
  weapon_id text check (weapon_id is null or weapon_id ~ '^[A-Za-z0-9_]{2,40}$'),
  value integer not null default 1 check (value between 0 and 1000),
  created_at timestamptz not null default now()
);

create table public.analytics_rate_limits (
  install_hash text not null,
  bucket_start timestamptz not null,
  bucket_type text not null check (bucket_type in ('minute', 'day')),
  count integer not null check (count >= 0),
  primary key (install_hash, bucket_start, bucket_type)
);

alter table public.admin_users enable row level security;
alter table public.quest_catalog enable row level security;
alter table public.feature_flags enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_rate_limits enable row level security;

insert into public.feature_flags (key, enabled)
values
  ('gamification_enabled', false),
  ('character_variants_enabled', false),
  ('analytics_enabled', false)
on conflict do nothing;

insert into public.quest_catalog (id, copy, event_type, target, enabled)
values
  ('charged_finisher_2', '꾹 와장창 2번', 'CHARGE_RELEASED', 2, false),
  ('characters_3', '캐릭터 3종 만나기', 'WEAPON_USED', 3, false),
  ('targets_3', '타겟 3개 부수기', 'TARGET_DESTROYED', 3, false)
on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and active
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

create policy "admin_users_read_self"
on public.admin_users
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "quest_catalog_read_current"
on public.quest_catalog
for select
to anon
using (
  enabled
  and (active_from is null or active_from <= now())
  and (active_to is null or active_to > now())
);

create policy "quest_catalog_admin_all"
on public.quest_catalog
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "feature_flags_read_public"
on public.feature_flags
for select
to anon
using (true);

create policy "feature_flags_admin_all"
on public.feature_flags
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "analytics_events_admin_read"
on public.analytics_events
for select
to authenticated
using (public.is_admin());

revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.quest_catalog from public, anon, authenticated;
revoke all on table public.feature_flags from public, anon, authenticated;
revoke all on table public.analytics_events from public, anon, authenticated;
revoke all on table public.analytics_rate_limits from public, anon, authenticated;
revoke all on type public.quest_event_type from public, anon, authenticated;
revoke all on type public.analytics_event_type from public, anon, authenticated;

grant select on table public.admin_users to authenticated;
grant select on table public.quest_catalog to anon;
grant select, insert, update, delete on table public.quest_catalog to authenticated;
grant select on table public.feature_flags to anon;
grant select, insert, update, delete on table public.feature_flags to authenticated;
grant select on table public.analytics_events to authenticated;
grant usage on type public.quest_event_type to anon, authenticated;
grant usage on type public.analytics_event_type to authenticated, service_role;

create view public.analytics_daily
with (security_invoker = true)
as
select
  day_key,
  event_type,
  weapon_id,
  count(*)::bigint as event_count,
  sum(value)::bigint as value_sum,
  avg(value)::numeric as average_value
from public.analytics_events
group by day_key, event_type, weapon_id;

revoke all on table public.analytics_daily from public, anon, authenticated;
grant select on table public.analytics_daily to authenticated;

create or replace function public.ingest_analytics(
  p_install_hash text,
  p_event_type public.analytics_event_type,
  p_day_key date,
  p_weapon_id text,
  p_value integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute_bucket timestamptz;
  v_day_bucket timestamptz;
  v_count integer;
begin
  if p_install_hash is null
    or p_install_hash !~ '^[a-f0-9]{64}$'
    or p_event_type is null
    or p_day_key is null
    or (p_weapon_id is not null and p_weapon_id !~ '^[A-Za-z0-9_]{2,40}$')
    or p_value is null
    or p_value < 0
    or p_value > 1000
  then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;

  v_minute_bucket := date_trunc('minute', v_now);
  v_day_bucket := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

  insert into public.analytics_rate_limits (install_hash, bucket_start, bucket_type, count)
  values (p_install_hash, v_minute_bucket, 'minute', 1)
  on conflict (install_hash, bucket_start, bucket_type)
  do update set count = public.analytics_rate_limits.count + 1
  returning count into v_count;

  if v_count > 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.analytics_rate_limits (install_hash, bucket_start, bucket_type, count)
  values (p_install_hash, v_day_bucket, 'day', 1)
  on conflict (install_hash, bucket_start, bucket_type)
  do update set count = public.analytics_rate_limits.count + 1
  returning count into v_count;

  if v_count > 1000 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.analytics_events (event_type, day_key, install_hash, weapon_id, value)
  values (p_event_type, p_day_key, p_install_hash, p_weapon_id, p_value);
end;
$$;

revoke all on function public.ingest_analytics(
  text,
  public.analytics_event_type,
  date,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.ingest_analytics(
  text,
  public.analytics_event_type,
  date,
  text,
  integer
) to service_role;
