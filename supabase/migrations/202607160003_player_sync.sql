create table public.player_progress (
  user_id uuid primary key references public.player_profiles(user_id) on delete cascade,
  account_seed uuid not null default gen_random_uuid(),
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 262144),
  last_operation_id bigint not null default 0 check (last_operation_id >= 0),
  updated_at timestamptz not null default now()
);

create table public.player_devices (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  device_id uuid not null,
  last_client_seq bigint not null default 0 check (last_client_seq >= 0),
  created_at timestamptz not null default now(),
  last_sync_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table public.player_sync_operations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  device_id uuid not null,
  client_seq bigint not null check (client_seq > 0),
  operation_id uuid not null,
  operation_version smallint not null check (operation_version = 1),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and pg_column_size(payload) <= 32768
  ),
  accepted_at timestamptz not null default now(),
  unique (operation_id),
  unique (user_id, device_id, client_seq),
  foreign key (user_id, device_id)
    references public.player_devices(user_id, device_id)
    on delete cascade
);

create index player_sync_operations_projection_idx
on public.player_sync_operations (user_id, id);

create table public.player_daily_assignments (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  day_key date not null,
  quest_id text not null check (quest_id ~ '^[a-z0-9_]{3,64}$'),
  quest jsonb not null check (jsonb_typeof(quest) = 'object' and pg_column_size(quest) <= 4096),
  target integer not null check (target between 1 and 100),
  progress integer not null default 0 check (progress between 0 and target),
  distinct_ids jsonb not null default '[]'::jsonb check (
    jsonb_typeof(distinct_ids) = 'array'
    and jsonb_array_length(distinct_ids) <= 64
  ),
  completed_at timestamptz,
  stamp_awarded boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  last_operation_id bigint not null default 0 check (last_operation_id >= 0),
  assigned_at timestamptz not null default now(),
  primary key (user_id, day_key),
  check ((completed_at is null and not stamp_awarded) or (completed_at is not null and stamp_awarded))
);

create table public.player_daily_completions (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  day_key date not null,
  quest_id text not null check (quest_id ~ '^[a-z0-9_]{3,64}$'),
  completed_at timestamptz not null default now(),
  primary key (user_id, day_key, quest_id)
);

create table public.player_sync_rate_limits (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  bucket_start timestamptz not null,
  count integer not null check (count between 0 and 100000),
  primary key (user_id, bucket_start)
);

create index player_sync_rate_limits_expiry_idx
on public.player_sync_rate_limits (bucket_start);

alter table public.player_progress enable row level security;
alter table public.player_devices enable row level security;
alter table public.player_sync_operations enable row level security;
alter table public.player_daily_assignments enable row level security;
alter table public.player_daily_completions enable row level security;
alter table public.player_sync_rate_limits enable row level security;

create or replace function public.new_player_progress_state(p_account_seed uuid)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'catalogVersion', 1,
    'installSeed', p_account_seed::text,
    'lifetime', jsonb_build_object(
      'validHits', 0,
      'chargedFinishers', 0,
      'totalTargets', 0,
      'bestCombo', 0,
      'stamps', 0,
      'distinctWeaponIds', '[]'::jsonb
    ),
    'byWeapon', '{}'::jsonb,
    'byTarget', jsonb_build_object(
      'word', jsonb_build_object('destroys', 0),
      'earth', jsonb_build_object('destroys', 0),
      'city', jsonb_build_object('destroys', 0)
    ),
    'achievements', '{}'::jsonb,
    'daily', jsonb_build_object(
      'dayKey', '',
      'questId', '',
      'target', 0,
      'progress', 0,
      'distinctIds', '[]'::jsonb,
      'completedAt', null,
      'stampAwarded', false
    ),
    'profile', jsonb_build_object(
      'selectedTitle', null,
      'skins', '{}'::jsonb,
      'strongInput', 'hold',
      'reducedMotion', false,
      'haptics', true
    )
  );
$$;

create or replace function public.initialize_player_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seed uuid := gen_random_uuid();
begin
  insert into public.player_progress (user_id, account_seed, state)
  values (new.user_id, v_seed, public.new_player_progress_state(v_seed))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger initialize_player_progress_after_profile
after insert on public.player_profiles
for each row execute function public.initialize_player_progress();

with missing as (
  select p.user_id, gen_random_uuid() as account_seed
  from public.player_profiles p
  left join public.player_progress progress on progress.user_id = p.user_id
  where progress.user_id is null
)
insert into public.player_progress (user_id, account_seed, state)
select user_id, account_seed, public.new_player_progress_state(account_seed)
from missing
on conflict (user_id) do nothing;

create or replace function public.accept_player_operations(
  p_user_id uuid,
  p_device_id uuid,
  p_expected_previous_seq bigint,
  p_operations jsonb
)
returns table(last_client_seq bigint, max_operation_id bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current bigint;
  v_item jsonb;
  v_seq bigint;
  v_existing record;
begin
  if p_expected_previous_seq < 0
    or jsonb_typeof(p_operations) <> 'array'
    or jsonb_array_length(p_operations) > 100
    or pg_column_size(p_operations) > 262144
  then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  insert into public.player_devices (user_id, device_id)
  values (p_user_id, p_device_id)
  on conflict do nothing;

  select d.last_client_seq
  into v_current
  from public.player_devices d
  where d.user_id = p_user_id and d.device_id = p_device_id
  for update;

  if v_current <> p_expected_previous_seq then
    raise exception 'sequence_gap' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_operations) loop
    begin
      v_seq := (v_item->>'clientSeq')::bigint;
    exception when others then
      raise exception 'invalid_operation' using errcode = '22023';
    end;
    if v_seq <> v_current + 1
      or (v_item->>'deviceId')::uuid <> p_device_id
      or (v_item->>'operationVersion')::smallint <> 1
      or pg_column_size(v_item) > 32768
    then
      raise exception 'sequence_gap' using errcode = 'P0001';
    end if;

    select o.user_id, o.device_id, o.client_seq
    into v_existing
    from public.player_sync_operations o
    where o.operation_id = (v_item->>'operationId')::uuid;
    if found then
      raise exception 'operation_id_conflict' using errcode = '23505';
    end if;

    begin
      insert into public.player_sync_operations (
        user_id,
        device_id,
        client_seq,
        operation_id,
        operation_version,
        payload
      ) values (
        p_user_id,
        p_device_id,
        v_seq,
        (v_item->>'operationId')::uuid,
        (v_item->>'operationVersion')::smallint,
        v_item
      );
    exception when unique_violation then
      raise exception 'operation_id_conflict' using errcode = '23505';
    end;
    v_current := v_seq;
  end loop;

  update public.player_devices
  set last_client_seq = v_current,
      last_sync_at = clock_timestamp()
  where user_id = p_user_id and device_id = p_device_id;

  return query
  select
    v_current,
    coalesce(max(o.id), 0)::bigint
  from public.player_sync_operations o
  where o.user_id = p_user_id;
end;
$$;

create or replace function public.compare_and_swap_player_progress(
  p_user_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_last_operation_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_expected_revision < 0
    or p_last_operation_id < 0
    or jsonb_typeof(p_state) <> 'object'
    or pg_column_size(p_state) > 262144
  then
    raise exception 'invalid_projection' using errcode = '22023';
  end if;

  update public.player_progress
  set state = p_state,
      last_operation_id = p_last_operation_id,
      revision = revision + 1,
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and revision = p_expected_revision
    and last_operation_id <= p_last_operation_id;
  return found;
end;
$$;

create or replace function public.ensure_player_daily_assignment(
  p_user_id uuid,
  p_day_key date,
  p_quest_id text,
  p_quest jsonb,
  p_target integer
)
returns table(
  day_key date,
  quest_id text,
  quest jsonb,
  target integer,
  progress integer,
  distinct_ids jsonb,
  completed_at timestamptz,
  stamp_awarded boolean,
  revision bigint,
  last_operation_id bigint,
  assigned_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_quest_id !~ '^[a-z0-9_]{3,64}$'
    or jsonb_typeof(p_quest) <> 'object'
    or pg_column_size(p_quest) > 4096
    or p_target < 1
    or p_target > 100
  then
    raise exception 'invalid_daily_assignment' using errcode = '22023';
  end if;

  insert into public.player_daily_assignments (user_id, day_key, quest_id, quest, target)
  values (p_user_id, p_day_key, p_quest_id, p_quest, p_target)
  on conflict on constraint player_daily_assignments_pkey do nothing;

  return query
  select
    a.day_key,
    a.quest_id,
    a.quest,
    a.target,
    a.progress,
    a.distinct_ids,
    a.completed_at,
    a.stamp_awarded,
    a.revision,
    a.last_operation_id,
    a.assigned_at
  from public.player_daily_assignments a
  where a.user_id = p_user_id and a.day_key = p_day_key;
end;
$$;

create or replace function public.compare_and_swap_player_daily(
  p_user_id uuid,
  p_day_key date,
  p_expected_revision bigint,
  p_state jsonb,
  p_last_operation_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target integer;
  v_progress integer;
  v_distinct_ids jsonb;
  v_completed_at timestamptz;
  v_stamp_awarded boolean;
begin
  select target into v_target
  from public.player_daily_assignments
  where user_id = p_user_id and day_key = p_day_key;
  if not found then return false; end if;

  begin
    v_progress := (p_state->>'progress')::integer;
    v_distinct_ids := p_state->'distinctIds';
    v_completed_at := (p_state->>'completedAt')::timestamptz;
    v_stamp_awarded := (p_state->>'stampAwarded')::boolean;
  exception when others then
    raise exception 'invalid_daily_projection' using errcode = '22023';
  end;

  if p_expected_revision < 0
    or p_last_operation_id < 0
    or jsonb_typeof(p_state) <> 'object'
    or v_progress < 0
    or v_progress > v_target
    or jsonb_typeof(v_distinct_ids) <> 'array'
    or jsonb_array_length(v_distinct_ids) > 64
    or ((v_completed_at is null) <> (not v_stamp_awarded))
  then
    raise exception 'invalid_daily_projection' using errcode = '22023';
  end if;

  update public.player_daily_assignments
  set progress = v_progress,
      distinct_ids = v_distinct_ids,
      completed_at = v_completed_at,
      stamp_awarded = v_stamp_awarded,
      last_operation_id = p_last_operation_id,
      revision = revision + 1
  where user_id = p_user_id
    and day_key = p_day_key
    and revision = p_expected_revision
    and last_operation_id <= p_last_operation_id;
  return found;
end;
$$;

create or replace function public.record_player_daily_completion(
  p_user_id uuid,
  p_day_key date,
  p_quest_id text,
  p_completed_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
begin
  if p_quest_id !~ '^[a-z0-9_]{3,64}$' or p_completed_at is null then
    raise exception 'invalid_daily_completion' using errcode = '22023';
  end if;
  insert into public.player_daily_completions (user_id, day_key, quest_id, completed_at)
  values (p_user_id, p_day_key, p_quest_id, p_completed_at)
  on conflict (user_id, day_key, quest_id) do nothing;
  select count(*) into v_count
  from public.player_daily_completions
  where user_id = p_user_id;
  return v_count;
end;
$$;

create or replace function public.consume_player_sync_limit(
  p_user_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 60 or p_window_seconds > 3600 then
    raise exception 'invalid_limit_request' using errcode = '22023';
  end if;
  v_bucket := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  insert into public.player_sync_rate_limits (user_id, bucket_start, count)
  values (p_user_id, v_bucket, 1)
  on conflict (user_id, bucket_start)
  do update set count = least(public.player_sync_rate_limits.count + 1, 100000)
  returning count into v_count;
  return query select
    v_count <= p_limit,
    case when v_count <= p_limit then 0 else greatest(
      1,
      ceil(extract(epoch from (v_bucket + make_interval(secs => p_window_seconds) - v_now)))::integer
    ) end;
end;
$$;

create or replace function public.cleanup_player_sync_rate_limits()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  with deleted as (
    delete from public.player_sync_rate_limits
    where bucket_start < clock_timestamp() - interval '2 hours'
    returning 1
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

revoke all on table public.player_progress from public, anon, authenticated;
revoke all on table public.player_devices from public, anon, authenticated;
revoke all on table public.player_sync_operations from public, anon, authenticated;
revoke all on table public.player_daily_assignments from public, anon, authenticated;
revoke all on table public.player_daily_completions from public, anon, authenticated;
revoke all on table public.player_sync_rate_limits from public, anon, authenticated;

revoke all on function public.new_player_progress_state(uuid) from public, anon, authenticated;
revoke all on function public.initialize_player_progress() from public, anon, authenticated;
revoke all on function public.accept_player_operations(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.compare_and_swap_player_progress(uuid, bigint, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.ensure_player_daily_assignment(uuid, date, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.compare_and_swap_player_daily(uuid, date, bigint, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.record_player_daily_completion(uuid, date, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_player_sync_limit(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.cleanup_player_sync_rate_limits() from public, anon, authenticated;

grant select on table public.player_progress to service_role;
grant select on table public.player_devices to service_role;
grant select on table public.player_sync_operations to service_role;
grant select on table public.player_daily_assignments to service_role;
grant select on table public.player_daily_completions to service_role;
grant execute on function public.new_player_progress_state(uuid) to service_role;
grant execute on function public.accept_player_operations(uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.compare_and_swap_player_progress(uuid, bigint, jsonb, bigint) to service_role;
grant execute on function public.ensure_player_daily_assignment(uuid, date, text, jsonb, integer) to service_role;
grant execute on function public.compare_and_swap_player_daily(uuid, date, bigint, jsonb, bigint) to service_role;
grant execute on function public.record_player_daily_completion(uuid, date, text, timestamptz) to service_role;
grant execute on function public.consume_player_sync_limit(uuid, integer, integer) to service_role;
grant execute on function public.cleanup_player_sync_rate_limits() to service_role;

select cron.schedule(
  'cleanup-player-sync-rate-limits',
  '29 * * * *',
  $command$select public.cleanup_player_sync_rate_limits();$command$
);
