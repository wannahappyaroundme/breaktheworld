import { Breakable } from './breakable'
import { drawCity } from '../art/city-art'
import { getImage, drawImageContain } from '../art/assets'

export function createCity(w: number, h: number): Breakable {
  return new Breakable({
    name: '도시',
    spriteW: Math.round(w * 0.92),
    spriteH: Math.round(Math.min(h * 0.5, w * 0.8)),
    fragments: 88,
    draw: (ctx, sw, sh) => {
      const img = getImage('city')
      if (img) drawImageContain(ctx, img, sw, sh)
      else drawCity(ctx, sw, sh)
    },
    centerYFrac: 0.5,
  })
}
