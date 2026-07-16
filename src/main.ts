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
import { PlayerApi } from './player/api'
import { PlayerAccountController } from './player/controller'
import { PlayerProfileView } from './player/view'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLElement

// Load any drop-in PNGs from public/assets/ first; start regardless of result.
preloadAssets(import.meta.env.BASE_URL).finally(() => {
  let profileView: PlayerProfileView | null = null
  let controller: PlayerAccountController | null = null
  const game = new Game(canvas, ui, {
    onOpenProfile: (trigger) => profileView?.open(trigger),
    onFeatureFlags: (flags) => controller?.setFeatureFlags(flags),
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
  controller = new PlayerAccountController({
    api: playerApi,
    onSnapshot: (snapshot) => {
      game.setPlayerAccount(snapshot)
      profileView?.render(snapshot)
    },
    onScope: (scope, generation) => game.setProgressScope(scope, generation),
  })
  profileView = new PlayerProfileView(ui, controller)
  void controller.start()

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
  void game.loadRemoteConfig(provider)
})
