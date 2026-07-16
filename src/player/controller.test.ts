import { describe, expect, it, vi } from 'vitest'

import { BUILT_IN_FLAGS } from '../config/feature-flags'
import { createPlayerPrivacyNotice } from './privacy'
import { PlayerAccountController, type PlayerAccountControllerOptions } from './controller'
import type { PlayerApiResult, PlayerProfile, PlayerProgressScope } from './types'

const PROFILE: PlayerProfile = {
  userId: '10000000-0000-4000-8000-000000000001',
  displayName: '예진',
  forcePinChange: false,
  credentialVersion: 1,
}

function ok<T>(data: T): PlayerApiResult<T> {
  return { ok: true, data }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function setup(overrides: Partial<PlayerAccountControllerOptions> = {}) {
  const api = {
    restoreSession: vi.fn(async () => ok<PlayerProfile | null>(null)),
    checkName: vi.fn(async () => ok(true)),
    create: vi.fn(async () => ok(PROFILE)),
    login: vi.fn(async () => ok(PROFILE)),
    changePin: vi.fn(async () => ok(PROFILE)),
    signOut: vi.fn(async () => ok(null)),
  }
  const snapshots: unknown[] = []
  const scopes: Array<{ scope: PlayerProgressScope; generation: number }> = []
  const notice = createPlayerPrivacyNotice({
    deletionContact: '프로필 삭제는 운영자에게 알려 주세요.',
    processingNotice: '기록은 한국 리전에 저장해요.',
  })
  const controller = new PlayerAccountController({
    api: api as never,
    onSnapshot: (snapshot) => { snapshots.push(snapshot) },
    onScope: (scope, generation) => { scopes.push({ scope, generation }) },
    flags: { ...BUILT_IN_FLAGS, player_profiles_ui: true, player_signup: true },
    privacyNotice: notice,
    createRequestId: () => '20000000-0000-4000-8000-000000000001',
    ...overrides,
  })
  return { api, controller, snapshots, scopes, notice }
}

describe('PlayerAccountController', () => {
  it('emits guest synchronously, then restores in the background', async () => {
    const pending = deferred<PlayerApiResult<PlayerProfile | null>>()
    const { api, controller, snapshots, scopes } = setup()
    api.restoreSession.mockReturnValueOnce(pending.promise)

    expect(controller.snapshot.kind).toBe('guest')
    expect(snapshots).toHaveLength(1)
    const started = controller.start()
    expect(controller.snapshot.kind).toBe('restoring')
    expect(scopes).toHaveLength(0)

    pending.resolve(ok(PROFILE))
    await started
    expect(controller.snapshot).toMatchObject({ kind: 'player', profile: PROFILE })
    expect(scopes).toEqual([{ scope: { kind: 'player', profile: PROFILE }, generation: 1 }])
  })

  it('invalidates duplicate confirmation immediately when the ID changes', async () => {
    const { controller, api } = setup()

    controller.editProfileName('예진')
    await expect(controller.checkName()).resolves.toEqual(ok(true))
    expect(controller.nameCheck.status).toBe('available')
    controller.editProfileName('예진2')
    expect(controller.nameCheck.status).toBe('idle')

    const rejected = await controller.create('예진2', '024550', '024550', true)
    expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(api.create).not.toHaveBeenCalled()
  })

  it('ignores a stale duplicate result for an older input', async () => {
    const pending = deferred<PlayerApiResult<boolean>>()
    const { controller, api } = setup()
    api.checkName.mockReturnValueOnce(pending.promise)
    controller.editProfileName('예진')
    const checked = controller.checkName()
    controller.editProfileName('예진2')

    pending.resolve(ok(true))
    await checked
    expect(controller.nameCheck).toMatchObject({ raw: '예진2', status: 'idle' })
  })

  it('creates only after current availability and emits a zero-scope player identity', async () => {
    const { controller, api, scopes } = setup()
    controller.editProfileName('예진')
    await controller.checkName()

    await expect(controller.create('예진', '024550', '024550', true)).resolves.toEqual(ok(PROFILE))
    expect(api.create).toHaveBeenCalledWith({
      requestId: '20000000-0000-4000-8000-000000000001',
      profileName: '예진',
      pin: '024550',
      pinConfirmation: '024550',
      over14: true,
    })
    expect(scopes[scopes.length - 1]?.scope).toEqual({ kind: 'player', profile: PROFILE })
  })

  it('keeps a temporary-PIN player out of account scope until the PIN changes', async () => {
    const forced = { ...PROFILE, forcePinChange: true, credentialVersion: 2 }
    const completed = { ...PROFILE, credentialVersion: 3 }
    const { controller, api, scopes } = setup()
    api.login.mockResolvedValueOnce(ok(forced))
    api.changePin.mockResolvedValueOnce(ok(completed))

    await controller.login('예진', '135790')
    expect(controller.snapshot).toMatchObject({ kind: 'player', forcePinChange: true })
    expect(scopes).toHaveLength(0)

    await controller.changePin('246802', '246802')
    expect(controller.snapshot).toMatchObject({ kind: 'player', forcePinChange: false })
    expect(scopes[scopes.length - 1]?.scope).toEqual({ kind: 'player', profile: completed })
  })

  it('invalidates a stale login when a newer logout finishes', async () => {
    const pending = deferred<PlayerApiResult<PlayerProfile>>()
    const { controller, api, scopes } = setup()
    api.login.mockReturnValueOnce(pending.promise)

    const login = controller.login('예진', '024550')
    await controller.logout()
    pending.resolve(ok(PROFILE))
    await login

    expect(controller.snapshot.kind).toBe('guest')
    expect(scopes[scopes.length - 1]?.scope).toEqual({ kind: 'guest' })
  })

  it('stays signed in when local logout cannot remove the session', async () => {
    const { controller, api } = setup()
    await controller.login('예진', '024550')
    api.signOut.mockResolvedValueOnce({
      ok: false,
      error: { code: 'service_unavailable', message: '이 기기에서 로그아웃을 다시 눌러 주세요.' },
    })

    const result = await controller.logout()
    expect(result.ok).toBe(false)
    expect(controller.snapshot.kind).toBe('player')
  })

  it('fails signup closed when deployment notice is incomplete but keeps login available', async () => {
    const { controller, api } = setup({
      flags: { ...BUILT_IN_FLAGS, player_profiles_ui: true, player_signup: true },
      privacyNotice: createPlayerPrivacyNotice({ deletionContact: '', processingNotice: '' }),
    })
    controller.editProfileName('예진')
    await controller.checkName()

    await expect(controller.create('예진', '024550', '024550', true)).resolves.toMatchObject({
      ok: false, error: { code: 'signup_closed' },
    })
    expect(api.create).not.toHaveBeenCalled()
    await expect(controller.login('예진', '024550')).resolves.toEqual(ok(PROFILE))
  })
})
