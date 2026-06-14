import './style.css'
import { Game } from './game'
import { preloadAssets } from './art/assets'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLElement

// Load any drop-in PNGs from public/assets/ first; start regardless of result.
preloadAssets(import.meta.env.BASE_URL).finally(() => {
  new Game(canvas, ui)
})
