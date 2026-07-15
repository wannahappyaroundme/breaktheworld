revoke execute on function public.ingest_analytics(
  text,
  public.analytics_event_type,
  date,
  text,
  integer
) from service_role;
revoke select on table public.analytics_daily from authenticated;
revoke execute on function public.is_admin() from authenticated;

drop view public.analytics_daily;

drop policy "analytics_events_admin_read" on public.analytics_events;
drop policy "feature_flags_admin_all" on public.feature_flags;
drop policy "feature_flags_read_public" on public.feature_flags;
drop policy "quest_catalog_admin_all" on public.quest_catalog;
drop policy "quest_catalog_read_current" on public.quest_catalog;
drop policy "admin_users_read_self" on public.admin_users;

drop function public.ingest_analytics(
  text,
  public.analytics_event_type,
  date,
  text,
  integer
);
drop function public.is_admin();

drop table public.analytics_rate_limits;
drop table public.analytics_events;
drop table public.feature_flags;
drop table public.quest_catalog;
drop table public.admin_users;

drop type public.analytics_event_type;
drop type public.quest_event_type;
