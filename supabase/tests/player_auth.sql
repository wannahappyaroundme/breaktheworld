begin;

create extension if not exists pgtap with schema extensions;

select plan(77);

select has_type('public', 'player_status', 'player status enum exists');
select has_type('public', 'player_admin_action', 'player admin action enum exists');
select has_table('public', 'player_profiles', 'player profiles table exists');
select has_table('public', 'player_auth_aliases', 'private player aliases table exists');
select has_table('public', 'player_auth_rate_limits', 'player auth rate-limit table exists');
select has_table('public', 'admin_audit_logs', 'player admin audit table exists');
select has_function('public', 'is_owner', array[]::text[], 'central owner check exists');
select has_function(
  'public',
  'consume_player_auth_limit',
  array['text', 'text', 'integer', 'interval'],
  'atomic player auth limiter exists'
);
select has_function(
  'public',
  'create_player_profile',
  array['uuid', 'text', 'text', 'text', 'integer', 'timestamp with time zone', 'uuid'],
  'atomic player profile creation RPC exists'
);
select has_function('public', 'cleanup_player_auth_rate_limits', array[]::text[], 'rate-limit cleanup exists');
select has_function('public', 'player_access_token_hook', array['jsonb'], 'custom access-token hook exists');

select is(
  enum_range(null::public.player_status)::text[],
  array['active', 'inactive']::text[],
  'player status exposes only active and inactive'
);
select is(
  enum_range(null::public.player_admin_action)::text[],
  array['pin_reset', 'deactivate', 'delete']::text[],
  'player admin actions expose only approved operations'
);
select is(
  (select count(*) from public.feature_flags),
  6::bigint,
  'all six feature flags are seeded'
);
select is(
  (select count(*) from public.feature_flags where key like 'player_%' and enabled),
  0::bigint,
  'all player flags default closed'
);
select is(
  (
    select count(*)
    from pg_class
    where oid in (
      'public.player_profiles'::regclass,
      'public.player_auth_aliases'::regclass,
      'public.player_auth_rate_limits'::regclass,
      'public.admin_audit_logs'::regclass
    ) and relrowsecurity
  ),
  4::bigint,
  'RLS is enabled on every player identity table'
);

select ok(not has_table_privilege('anon', 'public.player_profiles', 'select'), 'anon cannot read profiles');
select ok(not has_table_privilege('authenticated', 'public.player_profiles', 'select'), 'players cannot read profile rows directly');
select ok(not has_table_privilege('authenticated', 'public.player_auth_aliases', 'select'), 'players cannot read internal aliases');
select ok(not has_table_privilege('authenticated', 'public.player_auth_rate_limits', 'select'), 'players cannot inspect auth limits');
select ok(not has_table_privilege('authenticated', 'public.admin_audit_logs', 'select'), 'players cannot inspect admin audits');
select ok(has_table_privilege('service_role', 'public.player_profiles', 'select'), 'service functions can read profiles');
select ok(has_column_privilege('service_role', 'public.player_profiles', 'status', 'update'), 'service functions can change status');
select ok(has_column_privilege('service_role', 'public.player_profiles', 'credential_version', 'update'), 'service functions can invalidate credentials');
select ok(has_column_privilege('service_role', 'public.player_profiles', 'force_pin_change', 'update'), 'service functions can require a PIN change');
select ok(not has_column_privilege('service_role', 'public.player_profiles', 'display_name', 'update'), 'service functions cannot rename profiles');
select ok(has_table_privilege('service_role', 'public.player_auth_aliases', 'select'), 'service functions can resolve private aliases');
select ok(not has_table_privilege('service_role', 'public.player_auth_aliases', 'insert'), 'aliases are inserted only through the creation RPC');
select ok(has_table_privilege('service_role', 'public.admin_audit_logs', 'select'), 'service functions can resume audit sagas');
select ok(has_table_privilege('service_role', 'public.admin_audit_logs', 'insert'), 'service functions can begin audit sagas');
select ok(has_column_privilege('service_role', 'public.admin_audit_logs', 'step', 'update'), 'service functions can advance audit steps');

select ok(has_function_privilege('authenticated', 'public.is_owner()', 'execute'), 'authenticated operators can call owner check');
select ok(not has_function_privilege('anon', 'public.is_owner()', 'execute'), 'anon cannot call owner check');
select ok(
  has_function_privilege(
    'service_role',
    'public.consume_player_auth_limit(text,text,integer,interval)',
    'execute'
  ),
  'service role can consume auth limits'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_player_auth_limit(text,text,integer,interval)',
    'execute'
  ),
  'players cannot consume auth limits directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_player_profile(uuid,text,text,text,integer,timestamp with time zone,uuid)',
    'execute'
  ),
  'service role can create a player profile atomically'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_player_profile(uuid,text,text,text,integer,timestamp with time zone,uuid)',
    'execute'
  ),
  'players cannot execute profile creation directly'
);
select ok(
  has_function_privilege('supabase_auth_admin', 'public.player_access_token_hook(jsonb)', 'execute'),
  'Supabase Auth can execute the token hook'
);
select ok(
  not has_function_privilege('authenticated', 'public.player_access_token_hook(jsonb)', 'execute'),
  'players cannot execute the token hook'
);

select is(
  (
    select p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_owner'
  ),
  array['search_path=public, pg_temp']::text[],
  'owner check fixes its search path'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_owner'
  ),
  'owner check is security definer'
);
select is(
  (
    select p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'consume_player_auth_limit'
  ),
  array['search_path=public, pg_temp']::text[],
  'auth limiter fixes its search path'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'consume_player_auth_limit'
  ),
  'auth limiter is security definer'
);
select ok(
  (
    select p.provolatile = 's'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'player_access_token_hook'
  ),
  'token hook is stable'
);
select is(
  (
    select p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'player_access_token_hook'
  ),
  array['search_path=public, pg_temp']::text[],
  'token hook fixes its search path'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'player_profiles'
      and policyname = 'Auth hook reads current player credential'
      and 'supabase_auth_admin' = any (roles)
  ),
  'token hook has one dedicated RLS policy'
);
select ok(has_column_privilege('supabase_auth_admin', 'public.player_profiles', 'user_id', 'select'), 'Auth hook can read user UUID');
select ok(has_column_privilege('supabase_auth_admin', 'public.player_profiles', 'credential_version', 'select'), 'Auth hook can read credential version');
select ok(has_column_privilege('supabase_auth_admin', 'public.player_profiles', 'status', 'select'), 'Auth hook can read player status');
select ok(not has_column_privilege('supabase_auth_admin', 'public.player_profiles', 'display_name', 'select'), 'Auth hook cannot read display names');

select is(
  (select count(*) from cron.job where jobname = 'cleanup-player-auth-rate-limits'),
  1::bigint,
  'exactly one auth rate-limit cleanup job is scheduled'
);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'one@players.invalid', '', now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'two@players.invalid', '', now(), now()),
  ('20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'three@players.invalid', '', now(), now()),
  ('20000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'owner-player-test@test.local', '', now(), now()),
  ('20000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'cascade@players.invalid', '', now(), now());

insert into public.admin_users (user_id, role, active)
values ('20000000-0000-4000-8000-000000000004', 'owner', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000004', true);
select is(public.is_owner(), true, 'active owner passes the central owner check');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
select is(public.is_owner(), false, 'ordinary player is not an owner');
reset role;

set local role service_role;
select is(
  public.create_player_profile(
    '20000000-0000-4000-8000-000000000001',
    'Yejin',
    'yejin',
    '20000000-0000-4000-8000-000000000001@players.invalid',
    1,
    now(),
    '30000000-0000-4000-8000-000000000001'
  ),
  'created',
  'service role creates profile and alias atomically'
);
select is(
  public.create_player_profile(
    '20000000-0000-4000-8000-000000000001',
    'Yejin',
    'yejin',
    '20000000-0000-4000-8000-000000000001@players.invalid',
    1,
    now(),
    '30000000-0000-4000-8000-000000000001'
  ),
  'created',
  'same signup request safely resumes'
);
select is(
  public.create_player_profile(
    '20000000-0000-4000-8000-000000000002',
    'yejin',
    'yejin',
    '20000000-0000-4000-8000-000000000002@players.invalid',
    1,
    now(),
    '30000000-0000-4000-8000-000000000002'
  ),
  'duplicate_name',
  'ASCII case-insensitive duplicate name is rejected'
);
reset role;

select is((select count(*) from public.player_profiles where user_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'profile creation inserts one profile row');
select is((select count(*) from public.player_auth_aliases where user_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'profile creation inserts one alias row');
select is((select over_14_confirmed_at is not null from public.player_profiles where user_id = '20000000-0000-4000-8000-000000000001'), true, 'profile stores 14-plus confirmation time');

select throws_like(
  $$select public.create_player_profile(
    '20000000-0000-4000-8000-000000000001', '다른이름', '다른이름',
    '20000000-0000-4000-8000-000000000001@players.invalid', 1, now(),
    '30000000-0000-4000-8000-000000000001'
  )$$,
  '%signup_request_conflict%',
  'a signup request ID cannot be rebound to a different name'
);

select throws_like(
  $$insert into public.player_profiles (
    user_id, display_name, name_key, privacy_version, over_14_confirmed_at, signup_request_id
  ) values (
    '20000000-0000-4000-8000-000000000003', 'ㄱ예진', 'ㄱ예진', 1, now(),
    '30000000-0000-4000-8000-000000000003'
  )$$,
  '%violates check constraint%',
  'database rejects standalone Hangul jamo'
);
select throws_like(
  $$insert into public.player_profiles (
    user_id, display_name, name_key, privacy_version, over_14_confirmed_at, signup_request_id
  ) values (
    '20000000-0000-4000-8000-000000000003', '예 진', '예 진', 1, now(),
    '30000000-0000-4000-8000-000000000003'
  )$$,
  '%violates check constraint%',
  'database rejects spaces in profile IDs'
);
select throws_like(
  $$insert into public.player_profiles (
    user_id, display_name, name_key, privacy_version, over_14_confirmed_at, signup_request_id
  ) values (
    '20000000-0000-4000-8000-000000000003', 'ValidName', 'ValidName', 1, now(),
    '30000000-0000-4000-8000-000000000003'
  )$$,
  '%violates check constraint%',
  'database requires lowercase ASCII in the comparison key'
);
select throws_like(
  $$insert into public.player_profiles (
    user_id, display_name, name_key, privacy_version, over_14_confirmed_at, signup_request_id
  ) values (
    '20000000-0000-4000-8000-000000000003', 'ValidName', 'validname', 2, now(),
    '30000000-0000-4000-8000-000000000003'
  )$$,
  '%violates check constraint%',
  'database rejects an unknown privacy version'
);

insert into public.player_profiles (
  user_id, display_name, name_key, privacy_version, over_14_confirmed_at, signup_request_id
) values (
  '20000000-0000-4000-8000-000000000005', '삭제확인', '삭제확인', 1, now(),
  '30000000-0000-4000-8000-000000000005'
);
insert into public.player_auth_aliases (user_id, auth_email)
values (
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000005@players.invalid'
);
delete from auth.users where id = '20000000-0000-4000-8000-000000000005';
select is((select count(*) from public.player_profiles where user_id = '20000000-0000-4000-8000-000000000005'), 0::bigint, 'Auth deletion cascades the profile row');
select is((select count(*) from public.player_auth_aliases where user_id = '20000000-0000-4000-8000-000000000005'), 0::bigint, 'Auth deletion cascades the alias row');

select is(
  public.player_access_token_hook(jsonb_build_object(
    'user_id', '20000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('sub', '20000000-0000-4000-8000-000000000001')
  )) #>> '{claims,account_kind}',
  'player',
  'token hook marks player accounts'
);
select is(
  (public.player_access_token_hook(jsonb_build_object(
    'user_id', '20000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('sub', '20000000-0000-4000-8000-000000000001')
  )) #>> '{claims,credential_version}')::integer,
  1,
  'token hook includes current credential version'
);
select is(
  public.player_access_token_hook(jsonb_build_object(
    'user_id', '20000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('sub', '20000000-0000-4000-8000-000000000001')
  )) #>> '{claims,player_status}',
  'active',
  'token hook includes current player status'
);
select is(
  public.player_access_token_hook(jsonb_build_object(
    'user_id', '20000000-0000-4000-8000-000000000004',
    'claims', jsonb_build_object('sub', '20000000-0000-4000-8000-000000000004')
  )),
  jsonb_build_object(
    'user_id', '20000000-0000-4000-8000-000000000004',
    'claims', jsonb_build_object('sub', '20000000-0000-4000-8000-000000000004')
  ),
  'token hook leaves non-player operator claims unchanged'
);

set local role service_role;
select is(
  (select allowed from public.consume_player_auth_limit('login_requester', repeat('a', 64), 1, interval '1 minute')),
  true,
  'first auth attempt is allowed'
);
select is(
  (select allowed from public.consume_player_auth_limit('login_requester', repeat('a', 64), 1, interval '1 minute')),
  false,
  'attempt above the auth limit is rejected'
);
select ok(
  (select retry_after_seconds between 1 and 60 from public.consume_player_auth_limit('login_requester', repeat('a', 64), 1, interval '1 minute')),
  'rate-limited response includes a bounded database retry time'
);
reset role;

insert into public.player_auth_rate_limits (action, subject_hash, bucket_start, count)
values ('signup', repeat('b', 64), now() - interval '26 hours', 1);
set local role service_role;
select is(public.cleanup_player_auth_rate_limits(), 1::bigint, 'cleanup removes an expired auth limit bucket');
reset role;
select is((select count(*) from public.player_auth_rate_limits where subject_hash = repeat('b', 64)), 0::bigint, 'expired auth limit bucket is gone');
select ok((select count(*) from public.player_auth_rate_limits where subject_hash = repeat('a', 64)) > 0, 'cleanup keeps current auth limit buckets');

select is(
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'admin_audit_logs' and column_name ~ '(pin|name|email)'),
  0::bigint,
  'admin audit schema stores no PIN, profile name, or email column'
);

select * from finish();
rollback;
