import type { Weapon, World } from './weapon'
import type { Effect } from '../effects/types'
import * as fx from './fx'
import { explosion, shockwave, crack, beam, speedLines } from '../effects/primitives'
import { clamp, easeInCubic, easeOutCubic, easeOutBack } from '../engine/math'
import { getImage, drawImageCentered, type AssetName } from '../art/assets'
import {
  drawCinnamoroll,
  drawThanos,
  drawGauntlet,
  drawIronman,
  drawHulk,
  drawGodzilla,
  drawSaiyan,
  drawCat,
  drawDitto,
  drawPooh,
} from '../art/characters'

const EARTH = ['#7cc95a', '#4aa6e0', '#b07b4f', '#5fab3c', '#3b89c4']

type CharDrawer = (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void

/** Use a drop-in sprite (public/assets/<name>.png) if present, else the doodle. */
function charDraw(name: AssetName, fallback: CharDrawer): CharDrawer {
  return (ctx, cx, cy, s) => {
    const img = getImage(name)
    if (img) drawImageCentered(ctx, img, cx, cy, s * 1.35)
    else fallback(ctx, cx, cy, s)
  }
}

const drawIronmanA = charDraw('ironman', drawIronman)
const drawHulkA = charDraw('hulk', drawHulk)
const drawGodzillaA = charDraw('godzilla', drawGodzilla)
const drawSaiyanA = charDraw('dragonball', drawSaiyan)

/** Generic timed actor: plays for `dur`, fires onImpact once at `impactAt`. */
function actor(
  dur: number,
  impactAt: number,
  draw: (ctx: CanvasRenderingContext2D, p: number) => void,
  onImpact: () => void
): Effect {
  let t = 0
  let fired = false
  return {
    z: 2,
    update(dt) {
      t += dt
      if (!fired && t / dur >= impactAt) {
        fired = true
        onImpact()
      }
      return t < dur
    },
    draw(ctx) {
      draw(ctx, clamp(t / dur, 0, 1))
    },
  }
}

/** Fall-from-sky body slam used by the cute squashers. */
function slam(
  w: World,
  drawChar: (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void,
  o: { size?: number; color?: string; sfx?: 'thud' | 'squash' | 'goo'; extra?: (x: number, y: number) => void } = {}
): void {
  const x = w.target.cx
  const y = w.target.cy
  const size = Math.min(w.w, w.h) * (o.size ?? 0.55)
  const startY = -size * 0.7
  w.effects.add(
    actor(
      0.95,
      0.45,
      (ctx, p) => {
        let cy: number
        let expand = 0
        if (p < 0.45) {
          cy = startY + (y - startY) * easeInCubic(p / 0.45)
        } else {
          cy = y
          const f = (p - 0.45) / 0.55
          expand = Math.sin(clamp(f * 1.6, 0, 1) * Math.PI) * 0.4
        }
        ctx.save()
        ctx.translate(x, cy)
        ctx.scale(1 + expand, 1 - expand)
        ctx.translate(-x, -cy)
        drawChar(ctx, x, cy, size)
        ctx.restore()
      },
      () => {
        w.target.detachAll(x, y, 80, 'squash')
        w.effects.add(speedLines(x, y, { count: 16, color: o.color ?? '#ffd23f', r0: 24, r1: 190 }))
        w.effects.add(shockwave(x, y, 210, { color: '#ffffff', width: 12 }))
        fx.dust(w.particles, x, y, 24)
        fx.debris(w.particles, x, y, 26, EARTH)
        w.camera.shake(28)
        w.camera.punch(0.05)
        w.audio.play(o.sfx ?? 'thud')
        o.extra?.(x, y)
      }
    )
  )
  w.audio.play('whoosh')
}

const cinnamoroll: Weapon = {
  id: 'cinnamoroll',
  name: '시나모롤',
  icon: '☁️',
  mode: 'cinematic',
  cooldown: 0.9,
  apply(w) {
    slam(w, charDraw('cinnamoroll', drawCinnamoroll), { size: 0.5, color: '#ffd23f', sfx: 'thud' })
  },
}

const cat: Weapon = {
  id: 'cat',
  name: '고양이',
  icon: '🐱',
  mode: 'cinematic',
  cooldown: 0.9,
  apply(w) {
    slam(w, charDraw('cat', drawCat), { size: 0.5, color: '#ffb3c0', sfx: 'squash' })
  },
}

const pooh: Weapon = {
  id: 'pooh',
  name: '곰돌이 푸',
  icon: '🍯',
  mode: 'cinematic',
  cooldown: 0.95,
  apply(w) {
    slam(w, charDraw('pooh', drawPooh), {
      size: 0.5,
      color: '#ffb43a',
      sfx: 'goo',
      extra: (x, y) => {
        w.particles.burst(x, y, 26, 'dust', {
          speed: [60, 280],
          life: [0.6, 1.3],
          size: [6, 14],
          colors: ['#ffb43a', '#ffce4a', '#ffdf80'],
          gravity: 600,
          drag: 0.6,
        })
      },
    })
  },
}

const ditto: Weapon = {
  id: 'ditto',
  name: '메타몽',
  icon: '🟣',
  mode: 'cinematic',
  cooldown: 0.9,
  apply(w) {
    slam(w, charDraw('ditto', drawDitto), { size: 0.5, color: '#c9a3e8', sfx: 'goo' })
  },
}

const thanos: Weapon = {
  id: 'thanos',
  name: '타노스',
  icon: '🫰',
  mode: 'cinematic',
  cooldown: 1.1,
  apply(w) {
    const gx = w.target.cx
    const gy = Math.max(w.h * 0.3, w.target.cy - w.target.radius - 60)
    const size = Math.min(w.w, w.h) * 0.4
    w.effects.add(
      actor(
        1.15,
        0.5,
        (ctx, p) => {
          const s = easeOutBack(clamp(p / 0.42, 0, 1)) * size
          const snap = p > 0.42 && p < 0.6 ? Math.sin(p * 120) * 4 : 0
          const img = getImage('thanos')
          if (img) {
            drawImageCentered(ctx, img, gx + snap, gy - size * 0.2, s * 1.7)
          } else {
            drawThanos(ctx, gx, gy - size * 0.7, s * 0.7)
            drawGauntlet(ctx, gx + snap, gy, s)
          }
        },
        () => {
          w.target.detachFraction(0.5, 'dissolve')
          w.effects.add(speedLines(gx, gy, { count: 12, color: '#e3c6ff', r0: 12, r1: 150 }))
          fx.ash(w.particles, w.target.cx, w.target.cy, 34)
          w.camera.flash('#e3c6ff', 0.32)
          w.camera.shake(12)
          w.audio.play('snap')
        }
      )
    )
  },
}

const ironman: Weapon = {
  id: 'ironman',
  name: '아이언맨',
  icon: '🦾',
  mode: 'cinematic',
  cooldown: 1.0,
  apply(w) {
    const size = Math.min(w.w, w.h) * 0.3
    const hx = w.w * 0.28
    const hy = w.h * 0.26
    const tx = w.target.cx
    const ty = w.target.cy
    w.effects.add(
      actor(
        0.95,
        0.5,
        (ctx, p) => {
          const f = easeOutCubic(clamp(p / 0.45, 0, 1))
          const cx = -size + (hx + size) * f
          const cy = hy + Math.sin(p * 10) * 4
          drawIronmanA(ctx, cx, cy, size)
        },
        () => {
          w.effects.add(beam(hx, hy + size * 0.2, tx, ty, { color: '#bff0ff', core: '#fff', width: 18, dur: 0.35 }))
          w.target.detachAll(tx, ty, 85, 'fall')
          w.effects.add(explosion(tx, ty, 180))
          w.effects.add(shockwave(tx, ty, 210, { color: '#bff0ff', width: 12 }))
          fx.debris(w.particles, tx, ty, 28, EARTH)
          fx.fireBits(w.particles, tx, ty, 18)
          w.camera.shake(24)
          w.camera.flash('#dffaff', 0.3)
          w.audio.play('bigboom')
        }
      )
    )
    w.audio.play('whoosh')
  },
}

const hulk: Weapon = {
  id: 'hulk',
  name: '헐크',
  icon: '🟢',
  mode: 'cinematic',
  cooldown: 1.0,
  apply(w) {
    const x = w.target.cx
    const y = w.target.cy
    const size = Math.min(w.w, w.h) * 0.55
    const baseY = y + size * 0.25
    const startY = w.h + size * 0.7
    w.effects.add(
      actor(
        0.95,
        0.52,
        (ctx, p) => {
          let cy: number
          if (p < 0.5) cy = startY + (baseY - startY) * easeOutCubic(p / 0.5)
          else cy = baseY + Math.sin((p - 0.5) * 20) * 6
          drawHulkA(ctx, x, cy, size)
        },
        () => {
          w.target.detachAll(x, y, 95, 'fall')
          w.effects.add(crack(x, y, { branches: 9, len: 170 }))
          w.effects.add(shockwave(x, y, 250, { color: '#cdf5b0', width: 16 }))
          fx.debris(w.particles, x, y, 34, EARTH)
          fx.dust(w.particles, x, y, 22)
          w.camera.shake(32)
          w.camera.punch(0.06)
          w.audio.play('bigboom')
        }
      )
    )
    w.audio.play('whoosh')
  },
}

const godzilla: Weapon = {
  id: 'godzilla',
  name: '고질라',
  icon: '🦖',
  mode: 'cinematic',
  cooldown: 1.05,
  apply(w) {
    const tx = w.target.cx
    const ty = w.target.cy
    const size = Math.min(w.w, w.h) * 0.5
    const gx = w.w * 0.2
    const gy = w.h * 0.52
    w.effects.add(
      actor(
        1.0,
        0.55,
        (ctx, p) => {
          const f = easeOutCubic(clamp(p / 0.4, 0, 1))
          const cx = -size * 0.6 + (gx + size * 0.6) * f
          drawGodzillaA(ctx, cx, gy, size)
        },
        () => {
          const mouthX = gx + size * 0.45
          const mouthY = gy - size * 0.36
          w.effects.add(beam(mouthX, mouthY, tx, ty, { color: '#9b6cff', core: '#eaff00', width: 20, dur: 0.4 }))
          w.target.detachAll(tx, ty, 90, 'fall')
          w.effects.add(explosion(tx, ty, 175, { hot: '#eaff7a', cool: '#6b3bff' }))
          fx.fireBits(w.particles, tx, ty, 20)
          fx.debris(w.particles, tx, ty, 26, EARTH)
          w.camera.shake(26)
          w.camera.flash('#d9ffea', 0.28)
          w.audio.play('energy')
        }
      )
    )
    w.audio.play('whoosh')
  },
}

const saiyan: Weapon = {
  id: 'dragonball',
  name: '에너지파',
  icon: '🐉',
  mode: 'cinematic',
  cooldown: 1.15,
  apply(w) {
    const tx = w.target.cx
    const ty = w.target.cy
    const size = Math.min(w.w, w.h) * 0.42
    const sx = w.w * 0.18
    const sy = w.h * 0.55
    const hx = sx + size * 0.39
    const hy = sy + size * 0.3
    w.effects.add(
      actor(
        1.2,
        0.62,
        (ctx, p) => {
          drawSaiyanA(ctx, sx, sy, size)
          const cr = clamp(p / 0.6, 0, 1) * size * 0.4
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(1, cr))
          g.addColorStop(0, 'rgba(255,255,255,0.95)')
          g.addColorStop(0.5, 'rgba(120,200,255,0.7)')
          g.addColorStop(1, 'rgba(120,200,255,0)')
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(hx, hy, Math.max(1, cr), 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        },
        () => {
          w.effects.add(beam(hx, hy, tx, ty, { color: '#8fd0ff', core: '#fff', width: 30, dur: 0.5 }))
          w.effects.add(beam(hx, hy, w.w + 100, hy, { color: '#8fd0ff', core: '#fff', width: 22, dur: 0.5 }))
          w.target.detachAll(tx, ty, 100, 'fall')
          w.effects.add(explosion(tx, ty, 200))
          fx.debris(w.particles, tx, ty, 30, EARTH)
          fx.sparks(w.particles, tx, ty, 20, ['#8fd0ff', '#ffffff'])
          w.camera.shake(30)
          w.camera.flash('#dff0ff', 0.34)
          w.audio.play('bigboom')
        }
      )
    )
    w.audio.play('energy')
  },
}

// "예전" (previous) versions — the user's AI art, kept as separate weapons.
const cinnamorollOld: Weapon = {
  id: 'cinnamorollOld',
  name: '시나모롤(예전)',
  icon: '☁️',
  mode: 'cinematic',
  cooldown: 0.9,
  apply(w) {
    slam(w, charDraw('cinnamorollOld', drawCinnamoroll), { size: 0.5, color: '#ffd23f', sfx: 'thud' })
  },
}

const dittoOld: Weapon = {
  id: 'dittoOld',
  name: '메타몽(예전)',
  icon: '🟣',
  mode: 'cinematic',
  cooldown: 0.9,
  apply(w) {
    slam(w, charDraw('dittoOld', drawDitto), { size: 0.5, color: '#c9a3e8', sfx: 'goo' })
  },
}

export const characterWeapons: Weapon[] = [
  cinnamoroll,
  thanos,
  ironman,
  hulk,
  godzilla,
  saiyan,
  cat,
  ditto,
  pooh,
  cinnamorollOld,
  dittoOld,
]
