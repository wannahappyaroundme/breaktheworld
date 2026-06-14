import { Breakable } from './breakable'
import { drawWord } from '../art/word-art'
import { getImage, drawImageContain } from '../art/assets'

export function createWord(w: number, h: number): Breakable {
  return new Breakable({
    name: '세상',
    spriteW: Math.round(w * 0.9),
    spriteH: Math.round(Math.min(h * 0.36, w * 0.55)),
    fragments: 64,
    draw: (ctx, sw, sh) => {
      const img = getImage('word')
      if (img) drawImageContain(ctx, img, sw, sh)
      else drawWord(ctx, sw, sh)
    },
    centerYFrac: 0.45,
  })
}
