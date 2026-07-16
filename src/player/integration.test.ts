import { describe, expect, it, vi } from 'vitest'

import { Game } from '../game'
import { createDefaultProgress } from '../progress/defaults'
import type { PlayerAccountSnapshot } from './controller'
import type { PlayerProfile, PlayerProgressScope } from './types'

const PROFILE: PlayerProfile = {
  userId: '10000000-0000-4000-8000-000000000001',
  displayName: '예진',
  forcePinChange: false,
  credentialVersion: 1,
}

function progress(seed: string) {
  return {
    state: createDefaultProgress(seed),
    questCatalog: { version: 1, quests: [{}] },
    checkpoint: vi.fn(),
  }
}

describe('guest-first player integration', () => {
  it('checkpoints and cancels before an identity-scoped progress replacement', () => {
    const game = Object.create(Game.prototype) as Game & Record<string, unknown>
    const order: string[] = []
    const guest = progress('guest-seed')
    guest.state.lifetime.bestCombo = 31
    const player = progress('player-seed')
    const store = { kind: 'player-store' }
    Object.assign(game, {
      progress: guest,
      progressScopeIdentity: 'guest',
      progressScopeGeneration: 0,
      cancelAction: (reason: string) => { order.push(`cancel:${reason}`) },
      createProgressStoreForScope: (scope: PlayerProgressScope) => {
        order.push(`store:${scope.kind}`)
        return store
      },
      createProgress: (received: unknown) => {
        order.push(`progress:${received === store}`)
        return player
      },
      controller: {
        setStrongInput: () => { order.push('strong-input') },
      },
      hud: { setCombo: () => { order.push('combo') } },
      applyMotionSetting: () => { order.push('motion') },
      refreshProgressUI: () => { order.push('refresh') },
    })
    guest.checkpoint.mockImplementation(() => { order.push('checkpoint') })

    game.setProgressScope({ kind: 'player', profile: PROFILE }, 2)

    expect(order).toEqual([
      'cancel:settingsMode',
      'checkpoint',
      'store:player',
      'progress:true',
      'combo',
      'strong-input',
      'motion',
      'refresh',
    ])
    expect((game as never as { progress: unknown }).progress).toBe(player)
    expect(player.state.lifetime.bestCombo).toBe(0)
  })

  it('ignores stale and duplicate scope callbacks', () => {
    const game = Object.create(Game.prototype) as Game & Record<string, unknown>
    const createStore = vi.fn()
    Object.assign(game, {
      progress: progress('guest'),
      progressScopeIdentity: `player:${PROFILE.userId}`,
      progressScopeGeneration: 5,
      createProgressStoreForScope: createStore,
    })

    game.setProgressScope({ kind: 'guest' }, 4)
    game.setProgressScope({ kind: 'player', profile: PROFILE }, 5)

    expect(createStore).not.toHaveBeenCalled()
  })

  it('keeps a restored signed-in profile card visible even when discovery is closed', () => {
    const game = Object.create(Game.prototype) as Game & Record<string, unknown>
    const refresh = vi.fn()
    const snapshot: PlayerAccountSnapshot = {
      kind: 'player', profile: PROFILE, forcePinChange: false,
      card: {
        visible: true, kind: 'player', displayName: '예진', userId: PROFILE.userId,
        sync: 'saved', lastSavedAt: null,
      },
    }
    Object.assign(game, { playerAccount: null, refreshProgressUI: refresh })

    game.setPlayerAccount(snapshot)

    expect((game as never as { playerAccount: PlayerAccountSnapshot }).playerAccount).toBe(snapshot)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('boots Game before starting background session restoration and isolates public analytics', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8')

    expect(source.indexOf('new Game(')).toBeGreaterThan(-1)
    expect(source.indexOf('new Game(')).toBeLessThan(source.indexOf('controller.start()'))
    expect(source).not.toMatch(/await\s+controller\.start\(\)/)
    expect(source).toContain('getPublicSupabase()')
    expect(source).toContain('getPlayerSupabase()')
    expect(source).toContain('new PlayerApi(playerClient, clearPlayerSupabaseSession)')
  })
})
