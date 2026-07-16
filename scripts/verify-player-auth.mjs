import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

const PROFILE_NAME = 'AuthTest01'
const MISSING_NAME = 'GhostUser01'
const FIRST_PIN = '024550'
const RESET_PIN = '135790'
const FINAL_PIN = '246802'
let diagnosticStage = 'startup'

function parseEnvironment(raw) {
  const result = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    let value = match[2]
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value) } catch { value = value.slice(1, -1) }
    }
    result[match[1]] = value
  }
  return result
}

function required(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code)
  return value
}

function assertCondition(condition, code) {
  if (!condition) throw new Error(code)
}

function jwtClaims(accessToken) {
  const part = accessToken.split('.')[1]
  if (!part) return null
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) } catch { return null }
}

function status(label, expected, actual) {
  console.log(`${label}: expected ${expected}, actual ${actual}`)
  if (String(actual) !== String(expected)) throw new Error(`${label}_status`)
}

async function jsonResponse(response) {
  const raw = await response.text()
  try { return JSON.parse(raw) } catch { return null }
}

async function functionRequest(apiUrl, publishableKey, name, body, accessToken) {
  const response = await fetch(`${apiUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await jsonResponse(response) }
}

async function authRequest(apiUrl, key, path, body, accessToken) {
  const response = await fetch(`${apiUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await jsonResponse(response) }
}

function localSql(sql) {
  const projectId = basename(process.cwd()).replace(/[^a-zA-Z0-9_-]/g, '')
  return execFileSync('docker', [
    'exec',
    `supabase_db_${projectId}`,
    'psql',
    '-U', 'postgres',
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-tAc', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

async function waitForFunctions(apiUrl, publishableKey, child, runtimeReady) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error('function_server_stopped')
    try {
      const response = await functionRequest(apiUrl, publishableKey, 'player-auth', { action: 'unknown' })
      if (runtimeReady() && response.status === 400 && response.body?.code === 'invalid_request') return
    } catch {
      // The local gateway is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('function_server_timeout')
}

async function stopFunctionServer(child) {
  if (!child.pid || child.exitCode !== null) return
  const closed = new Promise((resolve) => child.once('close', resolve))
  try {
    process.kill(-child.pid, 'SIGINT')
  } catch {
    child.kill('SIGINT')
  }
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ])
  if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    await closed
  }
}

async function main() {
  diagnosticStage = 'status-read'
  const rawEnvironment = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  diagnosticStage = 'status-parse'
  const local = parseEnvironment(rawEnvironment)
  const apiUrl = required(local.API_URL, 'missing_api_url')
  const publishableKey = required(local.PUBLISHABLE_KEY ?? local.ANON_KEY, 'missing_publishable_key')
  const secretKey = required(local.SECRET_KEY ?? local.SERVICE_ROLE_KEY, 'missing_secret_key')
  diagnosticStage = 'client-create'
  const admin = createClient(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const publicClient = () => createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  diagnosticStage = 'pepper-file'
  const envPath = join(tmpdir(), `btw-player-auth-${process.pid}.env`)
  writeFileSync(envPath, [
    `PLAYER_RATE_LIMIT_PEPPER=${randomBytes(32).toString('hex')}`,
    `PLAYER_ADMIN_REQUEST_PEPPER=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n'), { mode: 0o600 })
  diagnosticStage = 'function-spawn'
  const functionServer = spawn('npx', [
    'supabase', 'functions', 'serve', 'player-auth', '--env-file', envPath,
  ], { cwd: process.cwd(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let runtimeReady = false
  const observeRuntime = (chunk) => {
    if (String(chunk).includes('Serving functions on')) runtimeReady = true
  }
  functionServer.stdout.on('data', observeRuntime)
  functionServer.stderr.on('data', observeRuntime)

  let ownerUserId = null
  let ownerAccessToken = null
  let playerUserId = null
  let originalSignupFlag = false
  let flagLoaded = false

  try {
    diagnosticStage = 'function-start'
    await waitForFunctions(apiUrl, publishableKey, functionServer, () => runtimeReady)

    diagnosticStage = 'signup-closed'
    const signup = await authRequest(apiUrl, publishableKey, 'signup', {
      email: `closed-${randomUUID()}@example.invalid`,
      password: randomBytes(18).toString('base64url'),
    })
    status('general signup closed', 422, signup.status)

    diagnosticStage = 'signup-flag'
    const flag = await publicClient().from('feature_flags').select('enabled')
      .eq('key', 'player_signup').maybeSingle()
    assertCondition(!flag.error && typeof flag.data?.enabled === 'boolean', 'signup_flag_lookup')
    originalSignupFlag = flag.data.enabled
    flagLoaded = true
    localSql("update public.feature_flags set enabled = true where key = 'player_signup';")

    diagnosticStage = 'owner-fixture'
    const ownerEmail = `owner-${randomUUID()}@example.invalid`
    const ownerPassword = randomBytes(24).toString('base64url')
    const ownerCreated = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    })
    assertCondition(!ownerCreated.error && !!ownerCreated.data.user?.id, 'owner_create')
    ownerUserId = ownerCreated.data.user.id
    localSql(`insert into public.admin_users (user_id, role, active) values ('${ownerUserId}'::uuid, 'owner', true) on conflict (user_id) do update set role = 'owner', active = true;`)
    const ownerSigned = await publicClient().auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    })
    assertCondition(!ownerSigned.error && !!ownerSigned.data.session?.access_token, 'owner_login')
    ownerAccessToken = ownerSigned.data.session.access_token

    diagnosticStage = 'player-create'
    const created = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'create',
      requestId: randomUUID(),
      profileName: PROFILE_NAME,
      pin: FIRST_PIN,
      pinConfirmation: FIRST_PIN,
      privacyVersion: 1,
      over14: true,
    })
    if (created.status !== 201) {
      diagnosticStage = created.body?.code === 'signup_closed'
        ? 'player-create-signup-closed'
        : 'player-create-service'
    }
    status('player create', 201, created.status)
    assertCondition(typeof created.body?.profile?.userId === 'string', 'player_create_shape')
    playerUserId = created.body.profile.userId

    diagnosticStage = 'duplicate-check'
    const duplicate = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'create',
      requestId: randomUUID(),
      profileName: PROFILE_NAME.toLowerCase(),
      pin: FIRST_PIN,
      pinConfirmation: FIRST_PIN,
      privacyVersion: 1,
      over14: true,
    })
    status('duplicate profile', 409, duplicate.status)

    diagnosticStage = 'device-login'
    const firstLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: PROFILE_NAME, pin: FIRST_PIN,
    })
    status('first device login', 200, firstLogin.status)
    const secondLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: PROFILE_NAME, pin: FIRST_PIN,
    })
    status('second device login', 200, secondLogin.status)
    const firstAccess = required(firstLogin.body?.accessToken, 'first_access_missing')
    const firstRefresh = required(firstLogin.body?.refreshToken, 'first_refresh_missing')
    const secondRefresh = required(secondLogin.body?.refreshToken, 'second_refresh_missing')

    diagnosticStage = 'local-logout'
    const localLogout = await authRequest(apiUrl, publishableKey, 'logout?scope=local', undefined, firstAccess)
    status('first device local logout', 204, localLogout.status)
    const secondStillWorks = await authRequest(apiUrl, publishableKey, 'token?grant_type=refresh_token', {
      refresh_token: secondRefresh,
    })
    status('second device refresh after local logout', 200, secondStillWorks.status)

    diagnosticStage = 'owner-reset'
    const reset = await functionRequest(apiUrl, publishableKey, 'manage-player', {
      action: 'reset-pin',
      requestId: randomUUID(),
      userId: playerUserId,
      pin: RESET_PIN,
      pinConfirmation: RESET_PIN,
    }, ownerAccessToken)
    status('owner PIN reset', 200, reset.status)

    diagnosticStage = 'session-invalidation'
    const firstRefreshAfterReset = await authRequest(apiUrl, publishableKey, 'token?grant_type=refresh_token', {
      refresh_token: firstRefresh,
    })
    status('first old refresh rejected', 400, firstRefreshAfterReset.status)
    const secondRefreshAfterReset = await authRequest(apiUrl, publishableKey, 'token?grant_type=refresh_token', {
      refresh_token: secondRefresh,
    })
    status('second old refresh rejected', 400, secondRefreshAfterReset.status)

    const oldAccess = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'session',
    }, firstAccess)
    status('old access rejected by version guard', 403, oldAccess.status)

    diagnosticStage = 'forced-pin-change'
    const temporaryLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: PROFILE_NAME, pin: RESET_PIN,
    })
    status('temporary PIN login', 200, temporaryLogin.status)
    assertCondition(temporaryLogin.body?.profile?.forcePinChange === true, 'temporary_force_change')
    const temporaryAccess = required(temporaryLogin.body?.accessToken, 'temporary_access_missing')
    const temporaryClaims = jwtClaims(temporaryAccess)
    if (
      temporaryClaims?.account_kind !== 'player'
      || temporaryClaims?.player_status !== 'active'
      || !Number.isSafeInteger(temporaryClaims?.credential_version)
    ) diagnosticStage = 'forced-pin-token-claims'
    assertCondition(diagnosticStage !== 'forced-pin-token-claims', 'temporary_claims_missing')

    const changed = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'change-pin', pin: FINAL_PIN, pinConfirmation: FINAL_PIN,
    }, temporaryAccess)
    if (changed.status !== 200) {
      diagnosticStage = changed.body?.code === 'session_expired'
        ? 'forced-pin-session-expired'
        : changed.body?.code === 'authentication_required'
          ? 'forced-pin-authentication-required'
          : 'forced-pin-service'
    }
    status('forced PIN change', 200, changed.status)
    assertCondition(changed.body?.profile?.forcePinChange === false, 'pin_change_not_finished')

    diagnosticStage = 'player-delete'
    const deleted = await functionRequest(apiUrl, publishableKey, 'manage-player', {
      action: 'delete',
      requestId: randomUUID(),
      userId: playerUserId,
      confirmation: PROFILE_NAME,
    }, ownerAccessToken)
    status('player delete', 200, deleted.status)

    diagnosticStage = 'deleted-login'
    const deletedLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: PROFILE_NAME, pin: FINAL_PIN,
    })
    status('deleted profile login', 401, deletedLogin.status)
    diagnosticStage = 'missing-login'
    const missingLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: MISSING_NAME, pin: FINAL_PIN,
    })
    status('missing profile login', 401, missingLogin.status)
    assertCondition(JSON.stringify(deletedLogin.body) === JSON.stringify(missingLogin.body), 'login_enumeration_difference')

    diagnosticStage = 'cleanup-assertions'
    const profileGone = await admin.from('player_profiles').select('user_id')
      .eq('user_id', playerUserId).maybeSingle()
    assertCondition(!profileGone.error && profileGone.data === null, 'player_profile_cleanup')
    const authGone = await admin.auth.admin.getUserById(playerUserId)
    assertCondition(!!authGone.error || !authGone.data.user, 'player_auth_cleanup')
    playerUserId = null
  } finally {
    if (playerUserId) await admin.auth.admin.deleteUser(playerUserId).catch(() => undefined)
    if (flagLoaded) {
      localSql(`update public.feature_flags set enabled = ${originalSignupFlag ? 'true' : 'false'} where key = 'player_signup';`)
    }
    if (ownerUserId) {
      try { localSql(`delete from public.admin_users where user_id = '${ownerUserId}'::uuid;`) } catch { /* fixed cleanup below */ }
      await admin.auth.admin.deleteUser(ownerUserId).catch(() => undefined)
      const remaining = localSql(`select count(*) from public.admin_users where user_id = '${ownerUserId}'::uuid;`)
      assertCondition(remaining === '0', 'owner_row_cleanup')
    }
    if (ownerAccessToken) ownerAccessToken = null
    await stopFunctionServer(functionServer)
    try { unlinkSync(envPath) } catch { /* already removed */ }
  }
}

main().then(() => {
  console.log('player auth verification passed')
}).catch(() => {
  console.error(`player auth verification failed at ${diagnosticStage}`)
  process.exitCode = 1
})
