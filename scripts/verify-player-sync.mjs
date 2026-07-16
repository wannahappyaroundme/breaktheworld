import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

const INITIAL_PIN = '024550'
const RESET_PIN = '135790'
const GUEST_FIXTURE_SEED = 'guest-fixture-never-upload'
const SCRIPT_PATH = fileURLToPath(import.meta.url)
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

function pass(label) {
  console.log(`PASS ${label}`)
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

function expectStatus(label, response, expected) {
  if (response.status !== expected) throw new Error(`${label}_status_${response.status}`)
  pass(label)
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

function kstDayKey() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function waitForFunctions(apiUrl, publishableKey, child, runtimeReady) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  try { process.kill(-child.pid, 'SIGINT') } catch { child.kill('SIGINT') }
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    await closed
  }
}

function emptyDelta(overrides = {}) {
  return {
    validHits: 0,
    chargedFinishers: 0,
    totalTargets: 0,
    bestCombo: 0,
    addDistinctWeaponIds: [],
    byWeapon: {},
    byTarget: { word: 0, earth: 0, city: 0 },
    achievements: {},
    settings: {},
    ...overrides,
  }
}

function operation(deviceId, clientSeq, delta, dayKey = kstDayKey()) {
  return {
    operationId: randomUUID(),
    operationVersion: 1,
    deviceId,
    clientSeq,
    createdAt: new Date().toISOString(),
    playDayKey: dayKey,
    dailyQuest: null,
    delta,
  }
}

function syncBody(deviceId, previousSeq, operations, knownRevision = 0) {
  return { deviceId, previousSeq, operations, knownRevision }
}

async function settleBatch(apiUrl, publishableKey, accessToken, body) {
  let last = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    last = await functionRequest(apiUrl, publishableKey, 'player-sync', body, accessToken)
    if (last.status === 200) return last
    if (last.status !== 503) return last
  }
  return last
}

async function pull(apiUrl, publishableKey, accessToken, deviceId, previousSeq) {
  return functionRequest(
    apiUrl,
    publishableKey,
    'player-sync',
    syncBody(deviceId, previousSeq, []),
    accessToken,
  )
}

function assertZeroProgress(state) {
  assertCondition(state?.schemaVersion === 1, 'zero_schema')
  assertCondition(state.installSeed !== GUEST_FIXTURE_SEED, 'guest_seed_imported')
  assertCondition(state.lifetime.validHits === 0, 'zero_valid_hits')
  assertCondition(state.lifetime.chargedFinishers === 0, 'zero_charged_finishers')
  assertCondition(state.lifetime.totalTargets === 0, 'zero_targets')
  assertCondition(state.lifetime.bestCombo === 0, 'zero_best_combo')
  assertCondition(state.lifetime.stamps === 0, 'zero_stamps')
  assertCondition(state.lifetime.distinctWeaponIds.length === 0, 'zero_distinct')
  assertCondition(Object.keys(state.byWeapon).length === 0, 'zero_weapons')
  assertCondition(Object.values(state.byTarget).every((value) => value.destroys === 0), 'zero_target_map')
  assertCondition(Object.keys(state.achievements).length === 0, 'zero_achievements')
  assertCondition(state.profile.selectedTitle === null, 'zero_title')
  assertCondition(Object.keys(state.profile.skins).length === 0, 'zero_skins')
  assertCondition(state.profile.strongInput === 'hold', 'zero_input')
  assertCondition(state.profile.reducedMotion === false, 'zero_motion')
  assertCondition(state.profile.haptics === true, 'zero_haptics')
}

function completionDelta(daily) {
  if (daily.quest?.event === 'CHARGE_RELEASED') {
    return emptyDelta({ chargedFinishers: daily.target })
  }
  if (daily.quest?.event === 'TARGET_DESTROYED') {
    return emptyDelta({
      validHits: daily.target,
      totalTargets: daily.target,
      byTarget: { word: daily.target, earth: 0, city: 0 },
    })
  }
  if (daily.quest?.event === 'WEAPON_USED') {
    const characterIds = ['cat', 'ditto', 'pooh'].slice(0, daily.target)
    return emptyDelta({
      validHits: characterIds.length,
      addDistinctWeaponIds: characterIds,
      byWeapon: Object.fromEntries(characterIds.map((id) => [id, {
        uses: 1,
        finishes: 0,
        addSeenMoves: ['quick'],
      }])),
    })
  }
  throw new Error('daily_assignment_missing')
}

async function resumeOutboxFixture(path) {
  const queued = JSON.parse(readFileSync(path, 'utf8'))
  const result = await functionRequest(
    queued.apiUrl,
    queued.publishableKey,
    'player-sync',
    queued.request,
    queued.accessToken,
  )
  writeFileSync(path, JSON.stringify({ status: result.status, body: result.body }), { mode: 0o600 })
}

async function main() {
  diagnosticStage = 'status-read'
  const rawEnvironment = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const local = parseEnvironment(rawEnvironment)
  const apiUrl = required(local.API_URL, 'missing_api_url')
  const publishableKey = required(local.PUBLISHABLE_KEY ?? local.ANON_KEY, 'missing_publishable_key')
  const secretKey = required(local.SECRET_KEY ?? local.SERVICE_ROLE_KEY, 'missing_secret_key')
  const admin = createClient(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const publicClient = () => createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const envPath = join(tmpdir(), `btw-player-sync-${process.pid}.env`)
  const outboxPath = join(tmpdir(), `btw-player-sync-outbox-${process.pid}.json`)
  writeFileSync(envPath, [
    `PLAYER_RATE_LIMIT_PEPPER=${randomBytes(32).toString('hex')}`,
    `PLAYER_ADMIN_REQUEST_PEPPER=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n'), { mode: 0o600 })
  const functionServer = spawn('npx', [
    'supabase', 'functions', 'serve', '--env-file', envPath,
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
  let playerDisplayName = null
  let originalSignup = false
  let originalWrites = false
  let flagsLoaded = false

  try {
    diagnosticStage = 'function-start'
    await waitForFunctions(apiUrl, publishableKey, functionServer, () => runtimeReady)

    diagnosticStage = 'flag-lookup'
    const flags = await publicClient().from('feature_flags').select('key,enabled')
      .in('key', ['player_signup', 'player_sync_writes'])
    assertCondition(!flags.error && flags.data?.length === 2, 'flag_lookup')
    originalSignup = flags.data.find((row) => row.key === 'player_signup')?.enabled === true
    originalWrites = flags.data.find((row) => row.key === 'player_sync_writes')?.enabled === true
    flagsLoaded = true
    diagnosticStage = 'flag-update'
    localSql("update public.feature_flags set enabled = true where key in ('player_signup','player_sync_writes');")

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
    const ownerSigned = await publicClient().auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
    assertCondition(!ownerSigned.error && !!ownerSigned.data.session?.access_token, 'owner_login')
    ownerAccessToken = ownerSigned.data.session.access_token

    diagnosticStage = 'player-create'
    playerDisplayName = `Sync${randomBytes(4).toString('hex')}`
    const created = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'create',
      requestId: randomUUID(),
      profileName: playerDisplayName,
      pin: INITIAL_PIN,
      pinConfirmation: INITIAL_PIN,
      privacyVersion: 1,
      over14: true,
    })
    expectStatus('new player created', created, 201)
    playerUserId = required(created.body?.profile?.userId, 'player_id_missing')

    const zeroRow = await admin.from('player_progress').select('state')
      .eq('user_id', playerUserId).maybeSingle()
    assertCondition(!zeroRow.error && !!zeroRow.data?.state, 'zero_progress_load')
    assertZeroProgress(zeroRow.data.state)
    assertCondition(JSON.stringify(zeroRow.data.state).includes('2455') === false, 'guest_fixture_value_imported')
    pass('new profile starts at zero without guest import')

    diagnosticStage = 'two-device-login'
    const firstLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: playerDisplayName, pin: INITIAL_PIN,
    })
    const secondLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: playerDisplayName, pin: INITIAL_PIN,
    })
    assertCondition(firstLogin.status === 200 && secondLogin.status === 200, 'device_login')
    const accessA = required(firstLogin.body?.accessToken, 'access_a_missing')
    const accessB = required(secondLogin.body?.accessToken, 'access_b_missing')
    const refreshA = required(firstLogin.body?.refreshToken, 'refresh_a_missing')
    const refreshB = required(secondLogin.body?.refreshToken, 'refresh_b_missing')
    const deviceA = randomUUID()
    const deviceB = randomUUID()
    let sequenceA = 0
    let sequenceB = 0

    diagnosticStage = 'initial-pull'
    const initial = await pull(apiUrl, publishableKey, accessA, deviceA, sequenceA)
    if (initial.status !== 200) diagnosticStage = `initial-pull-${initial.status}-${initial.body?.code ?? 'unknown'}`
    expectStatus('initial server projection loaded', initial, 200)
    assertCondition(initial.body?.state?.lifetime?.validHits === 0, 'initial_projection_nonzero')

    diagnosticStage = 'simultaneous-increments'
    const firstA = operation(deviceA, 1, emptyDelta({
      validHits: 1,
      totalTargets: 1,
      bestCombo: 12,
      addDistinctWeaponIds: ['hammer'],
      byWeapon: { hammer: { uses: 1, finishes: 1, addSeenMoves: ['quick'] } },
      byTarget: { word: 1, earth: 0, city: 0 },
    }))
    const firstB = operation(deviceB, 1, emptyDelta({
      validHits: 2,
      chargedFinishers: 1,
      totalTargets: 1,
      bestCombo: 8,
      addDistinctWeaponIds: ['cat'],
      byWeapon: { cat: { uses: 1, finishes: 0, addSeenMoves: ['pawTaps'] } },
      byTarget: { word: 0, earth: 1, city: 0 },
    }))
    const bodyA1 = syncBody(deviceA, 0, [firstA])
    const bodyB1 = syncBody(deviceB, 0, [firstB])
    await Promise.all([
      functionRequest(apiUrl, publishableKey, 'player-sync', bodyA1, accessA),
      functionRequest(apiUrl, publishableKey, 'player-sync', bodyB1, accessB),
    ])
    const settledA1 = await settleBatch(apiUrl, publishableKey, accessA, bodyA1)
    const settledB1 = await settleBatch(apiUrl, publishableKey, accessB, bodyB1)
    assertCondition(settledA1.status === 200 && settledB1.status === 200, 'simultaneous_settle')
    sequenceA = 1
    sequenceB = 1
    const simultaneous = await pull(apiUrl, publishableKey, accessA, deviceA, sequenceA)
    assertCondition(simultaneous.status === 200, 'simultaneous_pull')
    assertCondition(simultaneous.body.state.lifetime.validHits === 3, 'simultaneous_hits')
    assertCondition(simultaneous.body.state.lifetime.totalTargets === 2, 'simultaneous_targets')
    assertCondition(simultaneous.body.state.byWeapon.hammer.uses === 1, 'simultaneous_weapon_a')
    assertCondition(simultaneous.body.state.byWeapon.cat.uses === 1, 'simultaneous_weapon_b')
    pass('two-device simultaneous increments converge')

    diagnosticStage = 'duplicate-batch'
    const duplicate = await functionRequest(apiUrl, publishableKey, 'player-sync', bodyA1, accessA)
    expectStatus('duplicate batch acknowledged once', duplicate, 200)
    assertCondition(duplicate.body.state.lifetime.validHits === 3, 'duplicate_incremented')

    diagnosticStage = 'gap-recovery'
    const missingA = operation(deviceA, 2, emptyDelta({ validHits: 1 }))
    const laterA = operation(deviceA, 3, emptyDelta({ settings: { haptics: false } }))
    const gap = await functionRequest(
      apiUrl,
      publishableKey,
      'player-sync',
      syncBody(deviceA, 2, [laterA]),
      accessA,
    )
    assertCondition(gap.status === 409 && gap.body?.expectedPreviousSeq === 1, 'gap_not_rejected')
    const acceptedMissing = await settleBatch(
      apiUrl,
      publishableKey,
      accessA,
      syncBody(deviceA, 1, [missingA]),
    )
    assertCondition(acceptedMissing.status === 200, 'missing_not_accepted')
    const acceptedLater = await settleBatch(
      apiUrl,
      publishableKey,
      accessA,
      syncBody(deviceA, 2, [laterA]),
    )
    assertCondition(acceptedLater.status === 200, 'later_not_accepted')
    sequenceA = 3
    pass('gapped sequence rejects then succeeds in order')

    diagnosticStage = 'settings-concurrency'
    const settingsA = operation(deviceA, 4, emptyDelta({
      settings: { dittoSkin: 'classic', haptics: true },
    }))
    const settingsB = operation(deviceB, 2, emptyDelta({
      settings: { strongInput: 'doubleTap', cinnamorollSkin: 'classic' },
    }))
    const settingsBodyA = syncBody(deviceA, 3, [settingsA])
    const settingsBodyB = syncBody(deviceB, 1, [settingsB])
    await Promise.all([
      functionRequest(apiUrl, publishableKey, 'player-sync', settingsBodyA, accessA),
      functionRequest(apiUrl, publishableKey, 'player-sync', settingsBodyB, accessB),
    ])
    assertCondition((await settleBatch(apiUrl, publishableKey, accessA, settingsBodyA)).status === 200, 'settings_a')
    assertCondition((await settleBatch(apiUrl, publishableKey, accessB, settingsBodyB)).status === 200, 'settings_b')
    sequenceA = 4
    sequenceB = 2

    const conflictA = operation(deviceA, 5, emptyDelta({ settings: { reducedMotion: false } }))
    const conflictB = operation(deviceB, 3, emptyDelta({ settings: { reducedMotion: true } }))
    const conflictBodyA = syncBody(deviceA, 4, [conflictA])
    const conflictBodyB = syncBody(deviceB, 2, [conflictB])
    await Promise.all([
      functionRequest(apiUrl, publishableKey, 'player-sync', conflictBodyA, accessA),
      functionRequest(apiUrl, publishableKey, 'player-sync', conflictBodyB, accessB),
    ])
    assertCondition((await settleBatch(apiUrl, publishableKey, accessA, conflictBodyA)).status === 200, 'conflict_a')
    assertCondition((await settleBatch(apiUrl, publishableKey, accessB, conflictBodyB)).status === 200, 'conflict_b')
    sequenceA = 5
    sequenceB = 3
    const acceptedSettings = await admin.from('player_sync_operations').select('id,operation_id')
      .in('operation_id', [conflictA.operationId, conflictB.operationId])
      .order('id', { ascending: true })
    assertCondition(!acceptedSettings.error && acceptedSettings.data?.length === 2, 'conflict_order')
    const latestConflictId = acceptedSettings.data[1].operation_id
    const settingsProjection = await pull(apiUrl, publishableKey, accessA, deviceA, sequenceA)
    assertCondition(settingsProjection.status === 200, 'settings_pull')
    const profileSettings = settingsProjection.body.state.profile
    assertCondition(profileSettings.skins.ditto === 'classic', 'ditto_skin_lost')
    assertCondition(profileSettings.skins.cinnamoroll === 'classic', 'cinnamoroll_skin_lost')
    assertCondition(profileSettings.strongInput === 'doubleTap', 'strong_input_lost')
    assertCondition(profileSettings.haptics === true, 'haptics_lost')
    assertCondition(profileSettings.reducedMotion === (latestConflictId === conflictB.operationId), 'same_field_order')
    pass('concurrent settings merge by field and accepted order')

    diagnosticStage = 'achievement-union'
    const achievementA = operation(deviceA, 6, emptyDelta({
      achievements: {
        charge_master: { unlockedAt: '2026-07-16T00:00:00.000Z', seen: true },
      },
      settings: { selectedTitle: '꾹 와장창 장인', dittoSkin: 'classic' },
    }))
    const achievementB = operation(deviceB, 4, emptyDelta({
      bestCombo: 50,
      achievements: {
        combo_50: { unlockedAt: '2026-07-16T00:00:01.000Z', seen: false },
      },
      settings: { cinnamorollSkin: 'classic' },
    }))
    const achievementBodyA = syncBody(deviceA, 5, [achievementA])
    const achievementBodyB = syncBody(deviceB, 3, [achievementB])
    await Promise.all([
      functionRequest(apiUrl, publishableKey, 'player-sync', achievementBodyA, accessA),
      functionRequest(apiUrl, publishableKey, 'player-sync', achievementBodyB, accessB),
    ])
    assertCondition((await settleBatch(apiUrl, publishableKey, accessA, achievementBodyA)).status === 200, 'achievement_a')
    assertCondition((await settleBatch(apiUrl, publishableKey, accessB, achievementBodyB)).status === 200, 'achievement_b')
    sequenceA = 6
    sequenceB = 4
    const achievements = await pull(apiUrl, publishableKey, accessB, deviceB, sequenceB)
    assertCondition(achievements.status === 200, 'achievement_pull')
    assertCondition(!!achievements.body.state.achievements.charge_master, 'achievement_a_lost')
    assertCondition(!!achievements.body.state.achievements.combo_50, 'achievement_b_lost')
    assertCondition(achievements.body.state.profile.selectedTitle === '꾹 와장창 장인', 'title_lost')
    assertCondition(achievements.body.state.profile.skins.ditto === 'classic', 'achievement_ditto_skin')
    assertCondition(achievements.body.state.profile.skins.cinnamoroll === 'classic', 'achievement_cinnamoroll_skin')
    pass('achievements title and skins merge')

    diagnosticStage = 'daily-exact-once'
    const daily = achievements.body.state.daily
    assertCondition(daily?.dayKey === kstDayKey() && daily?.target > 0, 'daily_missing')
    const dailyA = operation(deviceA, 7, completionDelta(daily), daily.dayKey)
    const dailyB = operation(deviceB, 5, completionDelta(daily), daily.dayKey)
    const dailyBodyA = syncBody(deviceA, 6, [dailyA])
    const dailyBodyB = syncBody(deviceB, 4, [dailyB])
    await Promise.all([
      functionRequest(apiUrl, publishableKey, 'player-sync', dailyBodyA, accessA),
      functionRequest(apiUrl, publishableKey, 'player-sync', dailyBodyB, accessB),
    ])
    assertCondition((await settleBatch(apiUrl, publishableKey, accessA, dailyBodyA)).status === 200, 'daily_a')
    assertCondition((await settleBatch(apiUrl, publishableKey, accessB, dailyBodyB)).status === 200, 'daily_b')
    sequenceA = 7
    sequenceB = 5
    const dailyProjection = await pull(apiUrl, publishableKey, accessA, deviceA, sequenceA)
    const completionCount = await admin.from('player_daily_completions')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', playerUserId)
    assertCondition(dailyProjection.status === 200, 'daily_pull')
    assertCondition(completionCount.count === 1, 'daily_completion_duplicate')
    assertCondition(dailyProjection.body.state.lifetime.stamps === 1, 'daily_stamp_duplicate')
    pass('same daily completion awards one stamp')

    diagnosticStage = 'offline-restart'
    const offlineOperation = operation(deviceA, 8, emptyDelta({ validHits: 1 }))
    writeFileSync(outboxPath, JSON.stringify({
      apiUrl,
      publishableKey,
      accessToken: accessA,
      request: syncBody(deviceA, 7, [offlineOperation]),
    }), { mode: 0o600 })
    execFileSync(process.execPath, [SCRIPT_PATH, '--resume-outbox', outboxPath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    const resumed = JSON.parse(readFileSync(outboxPath, 'utf8'))
    assertCondition(resumed.status === 200 && resumed.body?.acknowledgedThrough === 8, 'offline_resume')
    sequenceA = 8
    pass('offline queue survives a process restart')

    diagnosticStage = 'reset-preserves-progress'
    const beforeReset = await admin.from('player_progress').select('state')
      .eq('user_id', playerUserId).maybeSingle()
    assertCondition(!beforeReset.error && !!beforeReset.data?.state, 'before_reset_load')
    const reset = await functionRequest(apiUrl, publishableKey, 'manage-player', {
      action: 'reset-pin',
      requestId: randomUUID(),
      userId: playerUserId,
      pin: RESET_PIN,
      pinConfirmation: RESET_PIN,
    }, ownerAccessToken)
    expectStatus('owner PIN reset', reset, 200)
    const refreshAfterResetA = await authRequest(apiUrl, publishableKey, 'token?grant_type=refresh_token', {
      refresh_token: refreshA,
    })
    const refreshAfterResetB = await authRequest(apiUrl, publishableKey, 'token?grant_type=refresh_token', {
      refresh_token: refreshB,
    })
    assertCondition(refreshAfterResetA.status === 400 && refreshAfterResetB.status === 400, 'refresh_not_invalidated')
    const oldSync = await pull(apiUrl, publishableKey, accessA, deviceA, sequenceA)
    assertCondition(oldSync.status === 403, 'old_access_not_invalidated')
    const afterReset = await admin.from('player_progress').select('state')
      .eq('user_id', playerUserId).maybeSingle()
    assertCondition(!afterReset.error && JSON.stringify(afterReset.data?.state) === JSON.stringify(beforeReset.data.state), 'reset_changed_progress')
    const temporaryLogin = await functionRequest(apiUrl, publishableKey, 'player-auth', {
      action: 'login', profileName: playerDisplayName, pin: RESET_PIN,
    })
    assertCondition(temporaryLogin.status === 200 && temporaryLogin.body?.profile?.forcePinChange === true, 'temporary_login')
    pass('PIN reset invalidates both devices and preserves progress')

    diagnosticStage = 'delete-cascade'
    const deleted = await functionRequest(apiUrl, publishableKey, 'manage-player', {
      action: 'delete',
      requestId: randomUUID(),
      userId: playerUserId,
      confirmation: playerDisplayName,
    }, ownerAccessToken)
    expectStatus('owner deletes player', deleted, 200)
    for (const table of [
      'player_profiles',
      'player_progress',
      'player_devices',
      'player_sync_operations',
      'player_daily_assignments',
      'player_daily_completions',
      'player_sync_rate_limits',
    ]) {
      const count = localSql(`select count(*) from public.${table} where user_id = '${playerUserId}'::uuid;`)
      if (count !== '0') diagnosticStage = `delete-cascade-${table}-${count}`
      assertCondition(count === '0', `delete_${table}`)
    }
    diagnosticStage = 'delete-cascade-auth'
    const authGone = await admin.auth.admin.getUserById(playerUserId)
    assertCondition(!!authGone.error || !authGone.data.user, 'delete_auth_user')
    playerUserId = null
    pass('profile deletion cascades every sync row')
  } finally {
    if (playerUserId) await admin.auth.admin.deleteUser(playerUserId).catch(() => undefined)
    if (flagsLoaded) {
      localSql(`update public.feature_flags set enabled = ${originalSignup ? 'true' : 'false'} where key = 'player_signup';`)
      localSql(`update public.feature_flags set enabled = ${originalWrites ? 'true' : 'false'} where key = 'player_sync_writes';`)
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
    try { unlinkSync(outboxPath) } catch { /* already removed */ }
  }
}

if (process.argv[2] === '--resume-outbox') {
  resumeOutboxFixture(required(process.argv[3], 'outbox_path_missing')).catch(() => {
    process.exitCode = 1
  })
} else {
  main().then(() => {
    console.log('player sync verification passed')
  }).catch(() => {
    console.error(`player sync verification failed at ${diagnosticStage}`)
    process.exitCode = 1
  })
}
