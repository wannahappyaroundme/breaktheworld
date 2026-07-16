do $$
begin
  if exists (select 1 from public.player_profiles)
    or exists (select 1 from public.admin_audit_logs)
  then
    raise exception 'player_profiles_not_empty';
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-player-auth-rate-limits';

drop policy "Auth hook reads current player credential" on public.player_profiles;

revoke execute on function public.player_access_token_hook(jsonb) from supabase_auth_admin;
revoke select (user_id, credential_version, status)
on table public.player_profiles from supabase_auth_admin;

drop function public.player_access_token_hook(jsonb);
drop function public.create_player_profile(uuid, text, text, text, integer, timestamptz, uuid);
drop function public.cleanup_player_auth_rate_limits();
drop function public.consume_player_auth_limit(text, text, integer, interval);
drop function public.is_owner();

drop table public.admin_audit_logs;
drop table public.player_auth_rate_limits;
drop table public.player_auth_aliases;
drop table public.player_profiles;

drop type public.player_admin_action;
drop type public.player_status;

delete from public.feature_flags
where key in ('player_profiles_ui', 'player_signup', 'player_sync_writes');

alter table public.feature_flags
drop constraint feature_flags_key_check;

alter table public.feature_flags
add constraint feature_flags_key_check check (
  key in ('gamification_enabled', 'character_variants_enabled', 'analytics_enabled')
);
