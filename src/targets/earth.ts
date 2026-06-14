import { Breakable } from './breakable'
import { drawEarth } from '../art/earth-art'
import { getImage, drawImageContain } from '../art/assets'

export function createEarth(w: number, h: number): Breakable {
  const size = Math.round(Math.min(w, h) * 0.72)
  return new Breakable({
    name: '지구',
    spriteW: size,
    spriteH: size,
    fragments: 74,
    draw: (ctx, sw, sh) => {
      const img = getImage('earth')
      if (img) drawImageContain(ctx, img, sw, sh)
      else drawEarth(ctx, sw, sh)
    },
    centerYFrac: 0.45,
  })
}
