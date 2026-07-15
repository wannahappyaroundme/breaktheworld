begin;

create extension if not exists pgtap with schema extensions;

select plan(91);

select has_type('public', 'quest_event_type', 'quest event enum exists');
select has_type('public', 'analytics_event_type', 'analytics event enum exists');
select has_table('public', 'admin_users', 'admin table exists');
select has_table('public', 'quest_catalog', 'quest table exists');
select has_table('public', 'feature_flags', 'flag table exists');
select has_table('public', 'analytics_events', 'analytics event table exists');
select has_table('public', 'analytics_rate_limits', 'analytics rate-limit table exists');
select has_view('public', 'analytics_daily', 'aggregate analytics view exists');
select has_function('public', 'is_admin', array[]::text[], 'central admin function exists');
select has_function(
  'public',
  'ingest_analytics',
  array['text', 'analytics_event_type', 'date', 'text', 'integer'],
  'atomic analytics RPC exists'
);
select is(
  enum_range(null::public.quest_event_type)::text[],
  array['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED']::text[],
  'quest event enum exposes only approved values'
);
select is(
  enum_range(null::public.analytics_event_type)::text[],
  array[
    'visit', 'first_hit', 'first_destroy', 'weapon_use', 'target_finish_actions',
    'charge_release', 'charge_cancel', 'quest_complete', 'share_complete'
  ]::text[],
  'analytics event enum exposes only approved values'
);

select is(
  (select count(*) from public.feature_flags where enabled),
  0::bigint,
  'all feature flags default closed'
);
select is(
  (select count(*) from public.feature_flags),
  3::bigint,
  'all three feature flags are seeded'
);
select is(
  (select count(*) from public.quest_catalog where enabled),
  0::bigint,
  'all built-in quests default disabled'
);
select is(
  (select count(*) from public.quest_catalog),
  3::bigint,
  'all three built-in quests are seeded'
);
select is(
  (
    select count(*)
    from pg_class
    where oid in (
      'public.admin_users'::regclass,
      'public.quest_catalog'::regclass,
      'public.feature_flags'::regclass,
      'public.analytics_events'::regclass,
      'public.analytics_rate_limits'::regclass
    )
      and relrowsecurity
  ),
  5::bigint,
  'RLS is enabled on every exposed table'
);
select is(
  (
    select p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ),
  array['search_path=public, pg_temp']::text[],
  'is_admin fixes its search path'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ),
  'is_admin is security definer'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ingest_analytics'
  ),
  'ingest RPC is security definer'
);
select is(
  (
    select p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ingest_analytics'
  ),
  array['search_path=public, pg_temp']::text[],
  'ingest RPC fixes its search path'
);
select ok(
  coalesce((select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.analytics_daily'::regclass), false),
  'aggregate view runs with caller permissions'
);
select ok(has_table_privilege('anon', 'public.quest_catalog', 'select'), 'anon can read public quests');
select ok(has_table_privilege('anon', 'public.feature_flags', 'select'), 'anon can read flags');
select ok(not has_table_privilege('anon', 'public.quest_catalog', 'insert'), 'anon cannot insert quests');
select ok(not has_table_privilege('anon', 'public.feature_flags', 'update'), 'anon cannot update flags');
select ok(not has_table_privilege('authenticated', 'public.analytics_events', 'insert'), 'browser roles cannot insert analytics directly');
select ok(not has_table_privilege('authenticated', 'public.admin_users', 'insert'), 'browser roles cannot insert admin accounts');
select ok(not has_table_privilege('authenticated', 'public.admin_users', 'update'), 'browser roles cannot update admin accounts');
select ok(not has_table_privilege('authenticated', 'public.admin_users', 'delete'), 'browser roles cannot delete admin accounts');
select ok(not has_table_privilege('anon', 'public.analytics_rate_limits', 'select'), 'anon cannot inspect rate limits');
select ok(not has_table_privilege('authenticated', 'public.analytics_rate_limits', 'select'), 'authenticated users cannot inspect rate limits');
select ok(
  not has_function_privilege('anon', 'public.ingest_analytics(text,public.analytics_event_type,date,text,integer)', 'execute'),
  'anon cannot execute ingest RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.ingest_analytics(text,public.analytics_event_type,date,text,integer)', 'execute'),
  'authenticated users cannot execute ingest RPC'
);
select ok(
  has_function_privilege('service_role', 'public.ingest_analytics(text,public.analytics_event_type,date,text,integer)', 'execute'),
  'only the service role can execute ingest RPC'
);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'viewer@test.local', '', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'operator@test.local', '', now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'owner@test.local', '', now(), now()),
  ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'disabled@test.local', '', now(), now());

insert into public.admin_users (user_id, role, active)
values
  ('10000000-0000-0000-0000-000000000002', 'operator', true),
  ('10000000-0000-0000-0000-000000000003', 'owner', true),
  ('10000000-0000-0000-0000-000000000004', 'operator', false);

select throws_like(
  $$insert into public.admin_users (user_id, role) values ('10000000-0000-0000-0000-000000000001', 'superuser')$$,
  '%violates check constraint%',
  'admin roles are bounded to owner and operator'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('Bad', '잘못된 식별자', 'TARGET_DESTROYED', 1)$$,
  '%violates check constraint%',
  'quest ids enforce the approved safe pattern'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('short_copy', '가', 'TARGET_DESTROYED', 1)$$,
  '%violates check constraint%',
  'quest copy enforces its minimum length'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('long_copy', repeat('가', 61), 'TARGET_DESTROYED', 1)$$,
  '%violates check constraint%',
  'quest copy enforces its maximum length'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('dash_copy', '긴 문장—연결', 'TARGET_DESTROYED', 1)$$,
  '%violates check constraint%',
  'quest copy rejects em dash'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('bad_event', '잘못된 이벤트', 'NOT_REAL', 1)$$,
  '%invalid input value for enum%',
  'quest events reject unknown values'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('bad_target', '잘못된 목표', 'TARGET_DESTROYED', 0)$$,
  '%violates check constraint%',
  'quest targets stay within bounds'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target, active_from, active_to) values ('bad_dates', '잘못된 일정', 'TARGET_DESTROYED', 1, now(), now() - interval '1 second')$$,
  '%violates check constraint%',
  'quest schedules reject reversed windows'
);
select throws_like(
  $$insert into public.quest_catalog (id, copy, event_type, target, version) values ('bad_version', '잘못된 버전', 'TARGET_DESTROYED', 1, 0)$$,
  '%violates check constraint%',
  'quest versions start at one'
);
select throws_like(
  $$insert into public.feature_flags (key) values ('unknown_flag')$$,
  '%violates check constraint%',
  'feature flags reject unknown keys'
);
select throws_like(
  $$insert into public.analytics_events (event_type, day_key, install_hash) values ('visit', current_date, 'short')$$,
  '%violates check constraint%',
  'analytics install hashes require 64 lowercase hex characters'
);
select throws_like(
  $$insert into public.analytics_events (event_type, day_key, install_hash, weapon_id) values ('weapon_use', current_date, repeat('f', 64), 'bad-id')$$,
  '%violates check constraint%',
  'analytics weapon ids enforce the approved safe pattern'
);
select throws_like(
  $$insert into public.analytics_events (event_type, day_key, install_hash, value) values ('visit', current_date, repeat('f', 64), 1001)$$,
  '%violates check constraint%',
  'analytics metric values stay within bounds'
);
select throws_like(
  $$insert into public.analytics_rate_limits (install_hash, bucket_start, bucket_type, count) values (repeat('f', 64), now(), 'hour', 1)$$,
  '%violates check constraint%',
  'rate-limit buckets reject unknown types'
);
select throws_like(
  $$insert into public.analytics_rate_limits (install_hash, bucket_start, bucket_type, count) values (repeat('f', 64), now(), 'minute', -1)$$,
  '%violates check constraint%',
  'rate-limit counters cannot be negative'
);

insert into public.quest_catalog (id, copy, event_type, target, active_from, active_to, enabled)
values
  ('current_public', '오늘 공개 도전', 'TARGET_DESTROYED', 2, now() - interval '1 hour', now() + interval '1 hour', true),
  ('future_public', '다음 공개 도전', 'TARGET_DESTROYED', 2, now() + interval '1 hour', null, true),
  ('expired_public', '지난 공개 도전', 'TARGET_DESTROYED', 2, null, now() - interval '1 hour', true),
  ('disabled_public', '닫힌 공개 도전', 'TARGET_DESTROYED', 2, null, null, false);

set local role anon;
select is((select count(*) from public.quest_catalog), 1::bigint, 'anon sees only enabled and current quests');
select is((select count(*) from public.feature_flags), 3::bigint, 'anon sees all feature flags');
select throws_ok(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('anon_write', '익명 쓰기', 'TARGET_DESTROYED', 1)$$,
  '42501',
  'permission denied for table quest_catalog',
  'anon cannot mutate quest config'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is(public.is_admin(), false, 'ordinary authenticated user is not an admin');
update public.feature_flags set enabled = true where key = 'gamification_enabled';
reset role;
select is((select enabled from public.feature_flags where key = 'gamification_enabled'), false, 'non-admin update leaves config unchanged');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('viewer_write', '일반 쓰기', 'TARGET_DESTROYED', 1)$$,
  '42501',
  'new row violates row-level security policy for table "quest_catalog"',
  'non-admin cannot insert config'
);
select is((select count(*) from public.analytics_events), 0::bigint, 'non-admin cannot read analytics events');
select is((select count(*) from public.analytics_daily), 0::bigint, 'non-admin cannot read analytics aggregates');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is(public.is_admin(), true, 'active operator is an admin');
select is((select count(*) from public.admin_users), 1::bigint, 'operator sees only their own admin row');
select lives_ok(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('operator_write', '운영자 도전', 'TARGET_DESTROYED', 1)$$,
  'operator can insert quests'
);
update public.quest_catalog set target = 2 where id = 'operator_write';
select is((select target from public.quest_catalog where id = 'operator_write'), 2, 'operator can update quests');
select lives_ok($$delete from public.quest_catalog where id = 'operator_write'$$, 'operator can delete quests');
update public.feature_flags set enabled = true where key = 'gamification_enabled';
select is((select enabled from public.feature_flags where key = 'gamification_enabled'), true, 'operator can update flags');
select throws_ok(
  $$update public.admin_users set active = false where user_id = '10000000-0000-0000-0000-000000000003'$$,
  '42501',
  'permission denied for table admin_users',
  'operator cannot mutate admin accounts directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select is(public.is_admin(), true, 'active owner is an admin');
select is((select count(*) from public.admin_users), 1::bigint, 'owner sees only their own admin row');
update public.feature_flags set enabled = true where key = 'character_variants_enabled';
select is((select enabled from public.feature_flags where key = 'character_variants_enabled'), true, 'owner can update flags');
select throws_ok(
  $$update public.admin_users set active = false where user_id = '10000000-0000-0000-0000-000000000002'$$,
  '42501',
  'permission denied for table admin_users',
  'owner cannot mutate admin accounts directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select is(public.is_admin(), false, 'disabled admin immediately loses admin status');
select is((select count(*) from public.admin_users), 1::bigint, 'disabled admin can still read their own status row');
select throws_ok(
  $$insert into public.quest_catalog (id, copy, event_type, target) values ('disabled_write', '비활성 쓰기', 'TARGET_DESTROYED', 1)$$,
  '42501',
  'new row violates row-level security policy for table "quest_catalog"',
  'disabled admin cannot mutate config'
);
select is((select count(*) from public.analytics_events), 0::bigint, 'disabled admin cannot read analytics');
reset role;

set local role service_role;
select lives_ok(
  $$select public.ingest_analytics(repeat('a', 64), 'visit', current_date, null, 1)$$,
  'service role can ingest one valid event'
);
reset role;
select is(
  (select count(*) from public.analytics_events where install_hash = repeat('a', 64)),
  1::bigint,
  'valid ingest inserts exactly one event'
);

set local role service_role;
select throws_ok(
  $$select public.ingest_analytics('short', 'visit', current_date, null, 1)$$,
  '22023',
  'invalid analytics event',
  'RPC rejects an invalid install hash'
);
select throws_ok(
  $$select public.ingest_analytics(repeat('b', 64), 'weapon_use', current_date, 'bad-id', 1)$$,
  '22023',
  'invalid analytics event',
  'RPC rejects an invalid weapon id'
);
select throws_ok(
  $$select public.ingest_analytics(repeat('b', 64), 'visit', current_date, null, 1001)$$,
  '22023',
  'invalid analytics event',
  'RPC rejects an out-of-range value'
);
select throws_ok(
  $$select public.ingest_analytics(repeat('b', 64), 'visit', null, null, 1)$$,
  '22023',
  'invalid analytics event',
  'RPC rejects a missing day key'
);
select lives_ok(
  $test$do $block$ begin for n in 1..30 loop perform public.ingest_analytics(repeat('c', 64), 'weapon_use', current_date, 'cat', 1); end loop; end $block$;$test$,
  'the first 30 items in a minute are accepted'
);
select throws_ok(
  $$select public.ingest_analytics(repeat('c', 64), 'weapon_use', current_date, 'cat', 1)$$,
  'P0001',
  'rate_limited',
  'item 31 in a minute is rejected'
);
reset role;
select is(
  (select count(*) from public.analytics_events where install_hash = repeat('c', 64)),
  30::bigint,
  'minute rejection does not insert an extra event'
);
select is(
  (select count from public.analytics_rate_limits where install_hash = repeat('c', 64) and bucket_type = 'minute'),
  30,
  'minute rejection rolls its counter back to 30'
);

insert into public.analytics_rate_limits (install_hash, bucket_start, bucket_type, count)
values (
  repeat('d', 64),
  date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC',
  'day',
  1000
);
set local role service_role;
select throws_ok(
  $$select public.ingest_analytics(repeat('d', 64), 'visit', current_date, null, 1)$$,
  'P0001',
  'rate_limited',
  'item 1001 in a day is rejected'
);
reset role;
select is(
  (select count(*) from public.analytics_events where install_hash = repeat('d', 64)),
  0::bigint,
  'daily rejection does not insert an extra event'
);
select is(
  (select count from public.analytics_rate_limits where install_hash = repeat('d', 64) and bucket_type = 'day'),
  1000,
  'daily rejection rolls its counter back to 1000'
);
select is(
  (select count(*) from public.analytics_rate_limits where install_hash = repeat('d', 64) and bucket_type = 'minute'),
  0::bigint,
  'daily rejection also rolls back the minute bucket'
);

set local role service_role;
select lives_ok(
  $$select public.ingest_analytics(repeat('e', 64), 'target_finish_actions', current_date, 'cat', 3)$$,
  'service role can ingest a bounded metric value'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select ok((select count(*) > 0 from public.analytics_events), 'active admin can read analytics events');
select is(
  (select average_value from public.analytics_daily where day_key = current_date and event_type = 'target_finish_actions' and weapon_id = 'cat'),
  3::numeric,
  'active admin reads aggregate values through the invoker view'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.analytics_daily), 0::bigint, 'invoker view preserves RLS for non-admins');
reset role;

select * from finish();
rollback;
