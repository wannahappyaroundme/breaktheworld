create extension if not exists pg_cron with schema pg_catalog;

create type public.player_status as enum ('active', 'inactive');
create type public.player_admin_action as enum ('pin_reset', 'deactivate', 'delete');

alter table public.feature_flags
drop constraint feature_flags_key_check;

alter table public.feature_flags
add constraint feature_flags_key_check check (
  key in (
    'gamification_enabled',
    'character_variants_enabled',
    'analytics_enabled',
    'player_profiles_ui',
    'player_signup',
    'player_sync_writes'
  )
);

insert into public.feature_flags (key, enabled)
values
  ('player_profiles_ui', false),
  ('player_signup', false),
  ('player_sync_writes', false)
on conflict (key) do nothing;

create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (
    char_length(display_name) between 2 and 12
    and display_name ~ '^[가-힣A-Za-z0-9]+$'
  ),
  name_key text not null unique check (
    char_length(name_key) between 2 and 12
    and name_key ~ '^[가-힣a-z0-9]+$'
  ),
  status public.player_status not null default 'active',
  credential_version integer not null default 1 check (
    credential_version between 1 and 2147483647
  ),
  force_pin_change boolean not null default false,
  privacy_version integer not null check (privacy_version = 1),
  over_14_confirmed_at timestamptz not null,
  signup_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_auth_aliases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auth_email text not null unique check (
    auth_email ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@players\.invalid$'
  ),
  created_at timestamptz not null default now()
);

create table public.player_auth_rate_limits (
  action text not null check (
    action in ('check_name', 'signup', 'login_name', 'login_requester')
  ),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bucket_start timestamptz not null,
  count integer not null check (count between 0 and 100000),
  primary key (action, subject_hash, bucket_start)
);

create index player_auth_rate_limits_expiry_idx
on public.player_auth_rate_limits (bucket_start);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action public.player_admin_action not null,
  request_id uuid not null unique,
  request_fingerprint text not null check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  outcome text not null check (outcome in ('started', 'completed', 'failed')),
  step text not null check (
    step in (
      'requested',
      'credential_invalidated',
      'password_changed',
      'sessions_revoked',
      'completed'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.player_profiles enable row level security;
alter table public.player_auth_aliases enable row level security;
alter table public.player_auth_rate_limits enable row level security;
alter table public.admin_audit_logs enable row level security;

create or replace function public.is_owner()
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
      and role = 'owner'
      and active
  );
$$;

create or replace function public.consume_player_auth_limit(
  p_action text,
  p_subject_hash text,
  p_limit integer,
  p_window interval
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_seconds numeric := extract(epoch from p_window);
  v_bucket timestamptz;
  v_count integer;
begin
  if p_action not in ('check_name', 'signup', 'login_name', 'login_requester')
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_limit < 1
    or p_limit > 1000
    or v_window_seconds < 60
    or v_window_seconds > 86400
  then
    raise exception 'invalid_limit_request' using errcode = '22023';
  end if;

  v_bucket := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );

  insert into public.player_auth_rate_limits (
    action,
    subject_hash,
    bucket_start,
    count
  ) values (
    p_action,
    p_subject_hash,
    v_bucket,
    1
  )
  on conflict (action, subject_hash, bucket_start)
  do update set count = least(public.player_auth_rate_limits.count + 1, 100000)
  returning count into v_count;

  return query select
    v_count <= p_limit,
    case
      when v_count <= p_limit then 0
      else greatest(
        1,
        ceil(extract(epoch from (v_bucket + p_window - v_now)))::integer
      )
    end;
end;
$$;

create or replace function public.cleanup_player_auth_rate_limits()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  with deleted as (
    delete from public.player_auth_rate_limits
    where bucket_start < clock_timestamp() - interval '25 hours'
    returning 1
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

create or replace function public.create_player_profile(
  p_user_id uuid,
  p_display_name text,
  p_name_key text,
  p_auth_email text,
  p_privacy_version integer,
  p_over_14_confirmed_at timestamptz,
  p_signup_request_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_user_id uuid;
  v_existing_name_key text;
  v_existing_auth_email text;
begin
  select p.user_id, p.name_key, a.auth_email
  into v_existing_user_id, v_existing_name_key, v_existing_auth_email
  from public.player_profiles p
  join public.player_auth_aliases a on a.user_id = p.user_id
  where p.signup_request_id = p_signup_request_id;

  if found then
    if v_existing_user_id = p_user_id
      and v_existing_name_key = p_name_key
      and v_existing_auth_email = p_auth_email
    then
      return 'created';
    end if;
    raise exception 'signup_request_conflict' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.player_profiles where name_key = p_name_key
  ) then
    return 'duplicate_name';
  end if;

  begin
    insert into public.player_profiles (
      user_id,
      display_name,
      name_key,
      privacy_version,
      over_14_confirmed_at,
      signup_request_id
    ) values (
      p_user_id,
      p_display_name,
      p_name_key,
      p_privacy_version,
      p_over_14_confirmed_at,
      p_signup_request_id
    );

    insert into public.player_auth_aliases (user_id, auth_email)
    values (p_user_id, p_auth_email);
    return 'created';
  exception when unique_violation then
    if exists (
      select 1 from public.player_profiles where name_key = p_name_key
    ) then
      return 'duplicate_name';
    end if;

    select p.user_id, p.name_key, a.auth_email
    into v_existing_user_id, v_existing_name_key, v_existing_auth_email
    from public.player_profiles p
    join public.player_auth_aliases a on a.user_id = p.user_id
    where p.signup_request_id = p_signup_request_id;

    if found
      and v_existing_user_id = p_user_id
      and v_existing_name_key = p_name_key
      and v_existing_auth_email = p_auth_email
    then
      return 'created';
    end if;
    if found then
      raise exception 'signup_request_conflict' using errcode = '22023';
    end if;
    raise;
  end;
end;
$$;

create or replace function public.player_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_claims jsonb := event->'claims';
  v_credential_version integer;
  v_status public.player_status;
begin
  select credential_version, status
  into v_credential_version, v_status
  from public.player_profiles
  where user_id = (event->>'user_id')::uuid;

  if not found then
    return event;
  end if;

  v_claims := jsonb_set(
    v_claims,
    '{credential_version}',
    to_jsonb(v_credential_version)
  );
  v_claims := jsonb_set(
    v_claims,
    '{player_status}',
    to_jsonb(v_status::text)
  );
  v_claims := jsonb_set(v_claims, '{account_kind}', '"player"'::jsonb);
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

revoke all on table public.player_profiles from public, anon, authenticated;
revoke all on table public.player_auth_aliases from public, anon, authenticated;
revoke all on table public.player_auth_rate_limits from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;
revoke all on type public.player_status from public, anon, authenticated;
revoke all on type public.player_admin_action from public, anon, authenticated;

revoke all on function public.is_owner() from public, anon, authenticated;
revoke all on function public.consume_player_auth_limit(text, text, integer, interval) from public, anon, authenticated;
revoke all on function public.cleanup_player_auth_rate_limits() from public, anon, authenticated;
revoke all on function public.create_player_profile(uuid, text, text, text, integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.player_access_token_hook(jsonb) from public, anon, authenticated;

grant execute on function public.is_owner() to authenticated;
grant execute on function public.consume_player_auth_limit(text, text, integer, interval) to service_role;
grant execute on function public.cleanup_player_auth_rate_limits() to service_role;
grant execute on function public.create_player_profile(uuid, text, text, text, integer, timestamptz, uuid) to service_role;

grant select on table public.player_profiles to service_role;
grant update (status, credential_version, force_pin_change, updated_at)
on table public.player_profiles to service_role;
grant select on table public.player_auth_aliases to service_role;
grant select, insert on table public.admin_audit_logs to service_role;
grant update (outcome, step, updated_at, completed_at)
on table public.admin_audit_logs to service_role;
grant usage, select on sequence public.admin_audit_logs_id_seq to service_role;
grant usage on type public.player_status to service_role;
grant usage on type public.player_admin_action to service_role;

grant usage on schema public to supabase_auth_admin;
grant select (user_id, credential_version, status)
on table public.player_profiles to supabase_auth_admin;
grant execute on function public.player_access_token_hook(jsonb) to supabase_auth_admin;

create policy "Auth hook reads current player credential"
on public.player_profiles
for select
to supabase_auth_admin
using (true);

select cron.schedule(
  'cleanup-player-auth-rate-limits',
  '17 * * * *',
  $command$select public.cleanup_player_auth_rate_limits();$command$
);
