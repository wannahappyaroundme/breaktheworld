do $$
declare
  v_rows bigint;
begin
  select
    (select count(*) from public.player_progress)
    + (select count(*) from public.player_devices)
    + (select count(*) from public.player_sync_operations)
    + (select count(*) from public.player_daily_assignments)
    + (select count(*) from public.player_daily_completions)
    + (select count(*) from public.player_sync_rate_limits)
  into v_rows;
  if v_rows > 0 then
    raise exception 'player_sync_rollback_refused_nonempty_schema';
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-player-sync-rate-limits';

drop trigger if exists initialize_player_progress_after_profile on public.player_profiles;
drop function if exists public.cleanup_player_sync_rate_limits();
drop function if exists public.consume_player_sync_limit(uuid, integer, integer);
drop function if exists public.record_player_daily_completion(uuid, date, text, timestamptz);
drop function if exists public.compare_and_swap_player_daily(uuid, date, bigint, jsonb, bigint);
drop function if exists public.ensure_player_daily_assignment(uuid, date, text, jsonb, integer);
drop function if exists public.compare_and_swap_player_progress(uuid, bigint, jsonb, bigint);
drop function if exists public.accept_player_operations(uuid, uuid, bigint, jsonb);
drop function if exists public.initialize_player_progress();
drop function if exists public.new_player_progress_state(uuid);

drop table if exists public.player_sync_rate_limits;
drop table if exists public.player_daily_completions;
drop table if exists public.player_daily_assignments;
drop table if exists public.player_sync_operations;
drop table if exists public.player_devices;
drop table if exists public.player_progress;
