alter type public.analytics_event_type add value if not exists 'achievement_hub_opened';
alter type public.analytics_event_type add value if not exists 'achievement_unlocked';
alter type public.analytics_event_type add value if not exists 'level_reached';
alter type public.analytics_event_type add value if not exists 'cosmetic_selected';
alter type public.analytics_event_type add value if not exists 'profile_step_viewed';

alter table public.analytics_events
add column dimension text,
add constraint analytics_dimension_shape
check (dimension is null or dimension ~ '^[a-z0-9_]{1,64}$');

drop view public.analytics_daily;

create view public.analytics_daily
with (security_invoker = true)
as
select
  day_key,
  event_type,
  weapon_id,
  dimension,
  count(*)::bigint as event_count,
  sum(value)::bigint as value_sum,
  avg(value)::numeric as average_value
from public.analytics_events
group by day_key, event_type, weapon_id, dimension;

revoke all on table public.analytics_daily from public, anon, authenticated;
grant select on table public.analytics_daily to authenticated;

create or replace function public.ingest_analytics_v2(
  p_install_hash text,
  p_event_type public.analytics_event_type,
  p_day_key date,
  p_weapon_id text,
  p_value integer,
  p_dimension text
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
  v_event_type text := p_event_type::text;
  v_valid boolean := false;
begin
  if p_install_hash is null
    or p_install_hash !~ '^[a-f0-9]{64}$'
    or p_event_type is null
    or p_day_key is null
    or (p_weapon_id is not null and p_weapon_id !~ '^[A-Za-z0-9_]{2,40}$')
    or p_value is null
    or p_value < 0
    or p_value > 1000
    or (p_dimension is not null and p_dimension !~ '^[a-z0-9_]{1,64}$')
  then
    raise exception 'invalid analytics event' using errcode = '22023';
  end if;

  if v_event_type in (
    'first_hit',
    'first_destroy',
    'weapon_use',
    'target_finish_actions',
    'charge_release',
    'charge_cancel'
  ) then
    v_valid := p_dimension is null
      and p_weapon_id in (
        'hammer', 'fist', 'glass', 'laser', 'meteor', 'missile',
        'bomb', 'lightning', 'flame', 'tornado', 'freeze', 'blackhole',
        'cinnamoroll', 'thanos', 'ironman', 'hulk', 'godzilla',
        'dragonball', 'cat', 'ditto', 'pooh'
      )
      and (
        (v_event_type = 'target_finish_actions' and p_value between 1 and 3)
        or (v_event_type <> 'target_finish_actions' and p_value = 1)
      );
  elsif v_event_type in ('visit', 'quest_complete', 'share_complete') then
    v_valid := p_dimension is null and p_weapon_id is null and p_value = 1;
  elsif v_event_type = 'achievement_hub_opened' then
    v_valid := p_weapon_id is null
      and p_dimension in ('hud', 'notice', 'profile')
      and p_value = 1;
  elsif v_event_type = 'achievement_unlocked' then
    select exists (
      select 1
      from (values
        ('first_hit', 50),
        ('first_destroy', 50),
        ('hits_100', 100),
        ('hits_1000', 200),
        ('destroys_25', 100),
        ('destroys_100', 200),
        ('favorite_weapon_50', 200),
        ('favorite_finisher_50', 400),
        ('charge_1', 50),
        ('charge_master', 100),
        ('charge_50', 200),
        ('combo_10', 50),
        ('combo_50', 100),
        ('combo_100', 200),
        ('moves_3', 50),
        ('moves_30', 400),
        ('weapons_3', 50),
        ('variety_10', 100),
        ('weapons_21', 200),
        ('finisher_1', 50),
        ('finishers_7', 100),
        ('finishers_21', 400),
        ('character_1', 50),
        ('characters_9', 100),
        ('world_cycle', 50),
        ('stamp_1', 50),
        ('stamps_7', 100),
        ('weapons_5x3', 100),
        ('world_10_each', 100),
        ('weapons_15x10', 200),
        ('world_50_each', 200),
        ('weapons_21x25', 400)
      ) as approved(dimension, value)
      where approved.dimension = p_dimension
        and approved.value = p_value
    ) into v_valid;
    v_valid := p_weapon_id is null and v_valid;
  elsif v_event_type = 'level_reached' then
    v_valid := p_weapon_id is null
      and p_value between 2 and 20
      and p_dimension = 'level_' || p_value::text;
  elsif v_event_type = 'cosmetic_selected' then
    v_valid := p_weapon_id is null
      and p_dimension in (
        'default',
        'first_crack',
        'electric_night',
        'coral_burst',
        'legend_crown'
      )
      and p_value = 1;
  elsif v_event_type = 'profile_step_viewed' then
    v_valid := p_weapon_id is null
      and p_dimension in ('choice', 'id', 'pin', 'complete')
      and p_value = 1;
  end if;

  if not coalesce(v_valid, false) then
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

  insert into public.analytics_events (
    event_type,
    day_key,
    install_hash,
    weapon_id,
    value,
    dimension
  ) values (
    p_event_type,
    p_day_key,
    p_install_hash,
    p_weapon_id,
    p_value,
    p_dimension
  );
end;
$$;

revoke all on function public.ingest_analytics_v2(
  text,
  public.analytics_event_type,
  date,
  text,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.ingest_analytics_v2(
  text,
  public.analytics_event_type,
  date,
  text,
  integer,
  text
) to service_role;

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
      'frameId', 'default',
      'recordBookThemeId', 'default',
      'strongInput', 'hold',
      'reducedMotion', false,
      'haptics', true
    )
  );
$$;
