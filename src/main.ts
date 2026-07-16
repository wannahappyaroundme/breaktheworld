import './style.css'
import { Game } from './game'
import { preloadAssets } from './art/assets'
import {
  clearPlayerSupabaseSession,
  getPlayerSupabase,
  getPublicSupabase,
} from './services/supabase'
import {
  RemoteQuestConfigProvider,
  createSupabaseRemoteConfigReader,
} from './config/quest-provider'
import { BUILT_IN_FLAGS, type FeatureFlags } from './config/feature-flags'
import { PlayerApi, createPlayerSyncTransport } from './player/api'
import { PlayerAccountController } from './player/controller'
import {
  PlayerEntryChoiceStore,
  decidePlayerEntry,
  withEntryTimeout,
} from './player/entry-choice'
import { PlayerProfileView } from './player/view'
import { PlayerOutbox } from './player/outbox'
import { PlayerSyncStore } from './player/sync-store'
import { PlayerSyncClient, type SyncStatus } from './player/sync-client'
import type { PlayerProgressScope } from './player/types'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLElement

// Load any drop-in PNGs from public/assets/ first; start regardless of result.
preloadAssets(import.meta.env.BASE_URL).finally(() => {
  let profileView: PlayerProfileView | null = null
  let controller: PlayerAccountController | null = null
  let activeSync: PlayerSyncClient | null = null
  let activeFlags: FeatureFlags = { ...BUILT_IN_FLAGS }
  const profileOutboxes = new Map<string, PlayerOutbox>()
  const entryChoice = new PlayerEntryChoiceStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  })
  const guestRememberedAtBoot = entryChoice.isGuestRemembered()
  const game = new Game(canvas, ui, {
    autoShowWhatsNew: false,
    onOpenProfile: (trigger) => profileView?.open(trigger),
    onFeatureFlags: (flags) => {
      const wasOpen = activeFlags.player_sync_writes
      activeFlags = { ...flags }
      controller?.setFeatureFlags(flags)
      if (!wasOpen && flags.player_sync_writes) void activeSync?.retry()
    },
  })
  let publicClient: ReturnType<typeof getPublicSupabase> = null
  let playerClient: ReturnType<typeof getPlayerSupabase> = null
  try {
    publicClient = getPublicSupabase()
  } catch {
    // Optional remote config and analytics stay offline without interrupting play.
  }
  try {
    playerClient = getPlayerSupabase()
  } catch {
    // Player login stays offline while guest play continues.
  }
  const playerApi = new PlayerApi(playerClient, clearPlayerSupabaseSession)
  const syncTransport = createPlayerSyncTransport(playerClient)

  const isCurrentPlayerScope = (scope: Extract<PlayerProgressScope, { kind: 'player' }>, generation: number) => (
    controller?.sessionGeneration === generation
    && controller.snapshot.kind === 'player'
    && controller.snapshot.profile.userId === scope.profile.userId
    && !controller.snapshot.forcePinChange
  )

  const connectPlayerScope = async (
    scope: Extract<PlayerProgressScope, { kind: 'player' }>,
    generation: number,
  ) => {
    activeSync?.stop()
    activeSync = null
    let syncClient: PlayerSyncClient | null = null
    const cachedOutbox = profileOutboxes.get(scope.profile.userId)
    const opened = cachedOutbox
      ? { mode: cachedOutbox.mode, outbox: cachedOutbox }
      : await PlayerOutbox.open({
          onMemoryFallback: () => controller?.setSyncStatus({ kind: 'memory', pending: 0 }),
        })
    profileOutboxes.set(scope.profile.userId, opened.outbox)
    if (!isCurrentPlayerScope(scope, generation)) return
    const local = game.createProgressStoreForScope(scope)
    const syncStore = new PlayerSyncStore(scope.profile.userId, local, opened.outbox, {
      onOperationReady: () => syncClient?.notifyOperationAppended(),
      onMemoryFallback: () => controller?.setSyncStatus({ kind: 'memory', pending: 0 }),
    })
    const recovery = await syncStore.recover()
    if (!isCurrentPlayerScope(scope, generation)) return
    game.setProgressScope(scope, generation, syncStore, recovery.revision)

    const renderStatus = (status: SyncStatus) => {
      if (!isCurrentPlayerScope(scope, generation)) return
      const visible = opened.outbox.mode === 'memory'
        && (status.kind === 'saving' || status.kind === 'offline')
        ? { kind: 'memory' as const, pending: 'pending' in status ? status.pending : 0 }
        : status
      controller?.setSyncStatus(visible)
    }
    syncClient = new PlayerSyncClient({
      userId: scope.profile.userId,
      generation,
      outbox: opened.outbox,
      transport: syncTransport,
      writesEnabled: () => activeFlags.player_sync_writes,
      getCurrentState: () => syncStore.load().state,
      onProjection: (projection) => { game.applyPlayerProjection(projection) },
      onStatus: renderStatus,
    })
    activeSync = syncClient
    if (opened.mode === 'memory' && recovery.pending > 0) {
      renderStatus({ kind: 'memory', pending: recovery.pending })
    }
    syncClient.start()
  }

  controller = new PlayerAccountController({
    api: playerApi,
    onSnapshot: (snapshot) => {
      game.setPlayerAccount(snapshot)
      profileView?.render(snapshot)
    },
    onScope: (scope, generation) => {
      if (scope.kind === 'guest') {
        activeSync?.stop()
        activeSync = null
        game.setProgressScope(scope, generation)
        return
      }
      void connectPlayerScope(scope, generation)
    },
    beforeLogout: () => activeSync?.flush(5_000) ?? Promise.resolve(0),
  })
  let startupReady = false
  let startupSettled = false
  const finishStartup = () => {
    startupReady = true
    if (startupSettled || profileView?.isOpen) return
    startupSettled = true
    game.maybeShowWhatsNewOnLoad()
  }
  profileView = new PlayerProfileView(ui, controller, {
    onRetrySave: () => { void activeSync?.retry() },
    onGuestChosen: () => {
      entryChoice.rememberGuest()
      finishStartup()
    },
    onAuthenticated: () => {
      entryChoice.clear()
      finishStartup()
    },
    onLoggedOut: () => {
      entryChoice.clear()
    },
    onClosed: () => {
      if (startupReady) finishStartup()
    },
  })
  if (!guestRememberedAtBoot) profileView.openRequired('checking')
  const restorePromise = controller.start()

  void game.connectAnalytics(publicClient)
  const provider = new RemoteQuestConfigProvider({
    reader: publicClient
      ? createSupabaseRemoteConfigReader(publicClient)
      : null,
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
  })
  const configPromise = game.loadRemoteConfig(provider)
  const entryDecisionPromise = Promise.all([restorePromise, configPromise]).then(([restore]) => (
    decidePlayerEntry({
      restore,
      profilesEnabled: activeFlags.player_profiles_ui,
      guestRemembered: guestRememberedAtBoot,
    })
  ))

  void withEntryTimeout(entryDecisionPromise, 8_000, 'fallback-guest').then(async (initial) => {
    if (initial.timedOut) {
      profileView?.releaseRequired()
      const lateDecision = await entryDecisionPromise
      if (lateDecision === 'player') entryChoice.clear()
      if (lateDecision === 'force') {
        profileView?.openRequired('choice')
        return
      }
      finishStartup()
      return
    }

    switch (initial.value) {
      case 'player':
        entryChoice.clear()
        profileView?.releaseRequired()
        finishStartup()
        break
      case 'force':
      case 'choose':
        profileView?.openRequired('choice')
        break
      case 'guest':
      case 'error':
      case 'fallback-guest':
        profileView?.releaseRequired()
        finishStartup()
        break
    }
  })
})
