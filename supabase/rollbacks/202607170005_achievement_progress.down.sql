drop function public.ingest_analytics_v2(
  text,
  public.analytics_event_type,
  date,
  text,
  integer,
  text
);

drop view public.analytics_daily;

alter table public.analytics_events
drop constraint analytics_dimension_shape,
drop column dimension;

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

-- The five added analytics enum labels intentionally remain unused after rollback.
-- Removing PostgreSQL enum labels requires a destructive type/table rewrite and is unsafe here.
