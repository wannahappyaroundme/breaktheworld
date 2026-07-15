import './style.css'
import { Game } from './game'
import { preloadAssets } from './art/assets'
import { getSupabase } from './services/supabase'
import {
  RemoteQuestConfigProvider,
  createSupabaseRemoteConfigReader,
} from './config/quest-provider'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLElement

// Load any drop-in PNGs from public/assets/ first; start regardless of result.
preloadAssets(import.meta.env.BASE_URL).finally(() => {
  const game = new Game(canvas, ui)
  let client: ReturnType<typeof getSupabase> = null
  try {
    client = getSupabase()
  } catch {
    // A malformed or blocked optional remote client must not interrupt local play.
  }
  void game.connectAnalytics(client)
  const provider = new RemoteQuestConfigProvider({
    reader: client
      ? createSupabaseRemoteConfigReader(client)
      : null,
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
  })
  void game.loadRemoteConfig(provider)
})
