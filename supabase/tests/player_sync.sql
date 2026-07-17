begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'player_progress', 'player progress table exists');
select has_table('public', 'player_devices', 'player devices table exists');
select has_table('public', 'player_sync_operations', 'player sync operations table exists');
select has_table('public', 'player_daily_assignments', 'daily assignments table exists');
select has_table('public', 'player_daily_completions', 'daily completions table exists');
select has_table('public', 'player_sync_rate_limits', 'sync rate limits table exists');

select has_function('public', 'new_player_progress_state', array['uuid'], 'zero-state factory exists');
select has_function(
  'public',
  'accept_player_operations',
  array['uuid', 'uuid', 'bigint', 'jsonb'],
  'contiguous acceptance RPC exists'
);
select has_function(
  'public',
  'compare_and_swap_player_progress',
  array['uuid', 'bigint', 'jsonb', 'bigint'],
  'account projection CAS exists'
);
select has_function(
  'public',
  'ensure_player_daily_assignment',
  array['uuid', 'date', 'text', 'jsonb', 'integer'],
  'daily assignment RPC exists'
);
select has_function(
  'public',
  'compare_and_swap_player_daily',
  array['uuid', 'date', 'bigint', 'jsonb', 'bigint'],
  'daily projection CAS exists'
);
select has_function(
  'public',
  'record_player_daily_completion',
  array['uuid', 'date', 'text', 'timestamp with time zone'],
  'unique daily completion RPC exists'
);
select has_function(
  'public',
  'consume_player_sync_limit',
  array['uuid', 'integer', 'integer'],
  'sync limiter exists'
);
select has_function('public', 'cleanup_player_sync_rate_limits', array[]::text[], 'sync cleanup exists');

select is(
  (
    select count(*)
    from pg_class
    where oid in (
      'public.player_progress'::regclass,
      'public.player_devices'::regclass,
      'public.player_sync_operations'::regclass,
      'public.player_daily_assignments'::regclass,
      'public.player_daily_completions'::regclass,
      'public.player_sync_rate_limits'::regclass
    ) and relrowsecurity
  ),
  6::bigint,
  'RLS is enabled on all sync tables'
);

select ok(not has_table_privilege('anon', 'public.player_progress', 'select'), 'anon cannot read player progress');
select ok(not has_table_privilege('authenticated', 'public.player_progress', 'select'), 'players cannot read progress directly');
select ok(not has_table_privilege('authenticated', 'public.player_devices', 'select'), 'players cannot inspect devices');
select ok(not has_table_privilege('authenticated', 'public.player_sync_operations', 'insert'), 'players cannot insert operations directly');
select ok(not has_table_privilege('authenticated', 'public.player_daily_assignments', 'select'), 'players cannot inspect daily rows');
select ok(not has_table_privilege('authenticated', 'public.player_daily_completions', 'select'), 'players cannot inspect completion rows');
select ok(not has_table_privilege('authenticated', 'public.player_sync_rate_limits', 'select'), 'players cannot inspect sync limits');

set local role authenticated;
select is(
  (select count(*) from public.feature_flags where key = 'player_sync_writes'),
  1::bigint,
  'authenticated players can read the public sync flag'
);
reset role;

select ok(
  has_function_privilege('service_role', 'public.accept_player_operations(uuid,uuid,bigint,jsonb)', 'execute'),
  'service role can accept operations'
);
select ok(
  not has_function_privilege('authenticated', 'public.accept_player_operations(uuid,uuid,bigint,jsonb)', 'execute'),
  'players cannot call acceptance RPC directly'
);
select ok(
  has_function_privilege('service_role', 'public.compare_and_swap_player_progress(uuid,bigint,jsonb,bigint)', 'execute'),
  'service role can CAS account projection'
);
select ok(
  not has_function_privilege('authenticated', 'public.compare_and_swap_player_progress(uuid,bigint,jsonb,bigint)', 'execute'),
  'players cannot CAS account projection'
);

select is(
  (select count(*) from cron.job where jobname = 'cleanup-player-sync-rate-limits'),
  1::bigint,
  'one sync cleanup job is scheduled'
);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('61000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sync-one@players.invalid', '', now(), now()),
  ('61000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sync-two@players.invalid', '', now(), now()),
  ('61000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'sync-cascade@players.invalid', '', now(), now());

insert into public.player_profiles (
  user_id, display_name, name_key, privacy_version, over_14_confirmed_at, signup_request_id
) values
  ('61000000-0000-4000-8000-000000000001', '동기화하나', '동기화하나', 1, now(), '62000000-0000-4000-8000-000000000001'),
  ('61000000-0000-4000-8000-000000000002', '동기화둘', '동기화둘', 1, now(), '62000000-0000-4000-8000-000000000002'),
  ('61000000-0000-4000-8000-000000000003', '동기화삭제', '동기화삭제', 1, now(), '62000000-0000-4000-8000-000000000003');

select is(
  (select count(*) from public.player_progress where user_id in (
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000003'
  )),
  3::bigint,
  'profile trigger creates one zero projection per player'
);
select is(
  (select revision from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  0::bigint,
  'new projection starts at revision zero'
);
select is(
  (select state - 'installSeed' from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  public.new_player_progress_state('61000000-0000-4000-8000-000000000001') - 'installSeed',
  'new player receives the exact all-zero/default state'
);
select is(
  (select (state #>> '{lifetime,totalTargets}')::integer from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  0,
  'new profile starts with zero destroyed targets'
);
select is(
  (select (state->>'schemaVersion')::integer from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  1,
  'new profile keeps progress schema version one'
);
select is(
  (select (state->>'catalogVersion')::integer from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  2,
  'new profile starts on achievement catalog version two'
);
select is(
  (select state #>> '{profile,frameId}' from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  'default',
  'new profile starts with the default frame'
);
select is(
  (select state #>> '{profile,recordBookThemeId}' from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'),
  'default',
  'new profile starts with the default record-book theme'
);

set local role service_role;
select is(
  (
    select last_client_seq
    from public.accept_player_operations(
      '61000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      0,
      jsonb_build_array(jsonb_build_object(
        'operationId', '64000000-0000-4000-8000-000000000001',
        'operationVersion', 1,
        'deviceId', '63000000-0000-4000-8000-000000000001',
        'clientSeq', 1,
        'createdAt', '2026-07-16T12:00:00.000Z',
        'playDayKey', '2026-07-16',
        'dailyQuest', null,
        'delta', jsonb_build_object('validHits', 1)
      ))
    )
  ),
  1::bigint,
  'first contiguous operation advances the device sequence'
);
reset role;

select is((select count(*) from public.player_sync_operations where user_id = '61000000-0000-4000-8000-000000000001'), 1::bigint, 'accepted operation is stored once');
select is((select last_sync_at is not null from public.player_devices where user_id = '61000000-0000-4000-8000-000000000001'), true, 'accepted operation records last sync time');

select throws_like(
  $$select * from public.accept_player_operations(
    '61000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000001',
    0,
    '[]'::jsonb
  )$$,
  '%sequence_gap%',
  'stale previous sequence is rejected without replay'
);
select is((select count(*) from public.player_sync_operations where operation_id = '64000000-0000-4000-8000-000000000001'), 1::bigint, 'duplicate retry cannot insert the operation twice');

select throws_like(
  $$select * from public.accept_player_operations(
    '61000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000001',
    1,
    jsonb_build_array(jsonb_build_object(
      'operationId', '64000000-0000-4000-8000-000000000003',
      'operationVersion', 1,
      'deviceId', '63000000-0000-4000-8000-000000000001',
      'clientSeq', 3
    ))
  )$$,
  '%sequence_gap%',
  'a missing device sequence rejects later operations'
);

set local role service_role;
select is(
  (
    select last_client_seq
    from public.accept_player_operations(
      '61000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      1,
      jsonb_build_array(jsonb_build_object(
        'operationId', '64000000-0000-4000-8000-000000000002',
        'operationVersion', 1,
        'deviceId', '63000000-0000-4000-8000-000000000001',
        'clientSeq', 2
      ))
    )
  ),
  2::bigint,
  'the missing sequence succeeds when sent next'
);
reset role;

select throws_like(
  $$select * from public.accept_player_operations(
    '61000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000002',
    0,
    jsonb_build_array(jsonb_build_object(
      'operationId', '64000000-0000-4000-8000-000000000001',
      'operationVersion', 1,
      'deviceId', '63000000-0000-4000-8000-000000000002',
      'clientSeq', 1
    ))
  )$$,
  '%operation_id_conflict%',
  'an operation UUID cannot be reused by another player'
);

set local role service_role;
select is(
  public.compare_and_swap_player_progress(
    '61000000-0000-4000-8000-000000000001',
    0,
    jsonb_set(
      public.new_player_progress_state('61000000-0000-4000-8000-000000000001'),
      '{lifetime,validHits}',
      '2'::jsonb
    ),
    2
  ),
  true,
  'matching account revision updates the projection'
);
select is(
  public.compare_and_swap_player_progress(
    '61000000-0000-4000-8000-000000000001',
    0,
    public.new_player_progress_state('61000000-0000-4000-8000-000000000001'),
    1
  ),
  false,
  'stale account revision cannot replace newer progress'
);
reset role;
select is((select revision from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'), 1::bigint, 'successful account CAS increments revision once');
select is((select last_operation_id from public.player_progress where user_id = '61000000-0000-4000-8000-000000000001'), 2::bigint, 'account CAS stores the operation boundary');

set local role service_role;
select is(
  (select quest_id from public.ensure_player_daily_assignment(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-16',
    'targets_3',
    '{"copy":"타겟 3개 부수기","event":"TARGET_DESTROYED","distinct":null}'::jsonb,
    3
  )),
  'targets_3',
  'server creates one daily assignment'
);
select is(
  (select quest_id from public.ensure_player_daily_assignment(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-16',
    'characters_3',
    '{"copy":"캐릭터 3종 만나기","event":"WEAPON_USED","distinct":"weaponId"}'::jsonb,
    3
  )),
  'targets_3',
  'a second client hint cannot replace the server assignment'
);
select is(
  public.compare_and_swap_player_daily(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-16',
    0,
    '{"progress":3,"distinctIds":[],"completedAt":"2026-07-16T12:10:00.000Z","stampAwarded":true}'::jsonb,
    2
  ),
  true,
  'matching daily revision updates the assignment'
);
select is(
  public.compare_and_swap_player_daily(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-16',
    0,
    '{"progress":0,"distinctIds":[],"completedAt":null,"stampAwarded":false}'::jsonb,
    1
  ),
  false,
  'stale daily revision cannot erase completion'
);
select is(
  public.record_player_daily_completion(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-16',
    'targets_3',
    '2026-07-16T12:10:00.000Z'
  ),
  1::bigint,
  'first completion awards one authoritative stamp'
);
select is(
  public.record_player_daily_completion(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-16',
    'targets_3',
    '2026-07-16T12:20:00.000Z'
  ),
  1::bigint,
  'second phone cannot award the same daily stamp twice'
);
select is(
  (select completed_at from public.player_daily_completions where user_id = '61000000-0000-4000-8000-000000000001' and day_key = '2026-07-16'),
  '2026-07-16T12:10:00.000Z'::timestamptz,
  'completion keeps the earliest accepted timestamp'
);

select is(
  (select quest_id from public.ensure_player_daily_assignment(
    '61000000-0000-4000-8000-000000000001',
    '2026-07-15',
    'charged_finisher_2',
    '{"copy":"꾹 와장창 2번","event":"CHARGE_RELEASED","distinct":null}'::jsonb,
    2
  )),
  'charged_finisher_2',
  'late offline evidence can retain an older day assignment'
);

select is(
  (select allowed from public.consume_player_sync_limit('61000000-0000-4000-8000-000000000001', 60, 60)),
  true,
  'first sync request is allowed'
);
do $$
begin
  for i in 1..59 loop
    perform * from public.consume_player_sync_limit('61000000-0000-4000-8000-000000000001', 60, 60);
  end loop;
end;
$$;
select is(
  (select allowed from public.consume_player_sync_limit('61000000-0000-4000-8000-000000000001', 60, 60)),
  false,
  'request 61 in one minute is rejected'
);
reset role;

insert into public.player_sync_rate_limits (user_id, bucket_start, count)
values ('61000000-0000-4000-8000-000000000002', now() - interval '3 hours', 1);
set local role service_role;
select is(public.cleanup_player_sync_rate_limits(), 1::bigint, 'cleanup removes sync buckets older than two hours');
reset role;

delete from auth.users where id = '61000000-0000-4000-8000-000000000003';
select is((select count(*) from public.player_progress where user_id = '61000000-0000-4000-8000-000000000003'), 0::bigint, 'profile deletion cascades progress');
select is((select count(*) from public.player_devices where user_id = '61000000-0000-4000-8000-000000000003'), 0::bigint, 'profile deletion cascades devices');
select is((select count(*) from public.player_sync_operations where user_id = '61000000-0000-4000-8000-000000000003'), 0::bigint, 'profile deletion cascades operations');
select is((select count(*) from public.player_daily_assignments where user_id = '61000000-0000-4000-8000-000000000003'), 0::bigint, 'profile deletion cascades daily assignments');
select is((select count(*) from public.player_daily_completions where user_id = '61000000-0000-4000-8000-000000000003'), 0::bigint, 'profile deletion cascades completions');

select * from finish();
rollback;
