import type { Weapon } from './weapon'
import * as fx from './fx'
import {
  explosion,
  shockwave,
  crack,
  beam,
  projectile,
  speedLines,
  lightning,
  blackhole,
  frostRing,
  tornado,
} from '../effects/primitives'
import { rng } from '../engine/rng'

const EARTH = ['#7cc95a', '#4aa6e0', '#b07b4f', '#5fab3c', '#3b89c4']

const hammer: Weapon = {
  id: 'hammer',
  name: '망치',
  icon: '🔨',
  mode: 'point',
  apply(w, x, y) {
    w.target.takeDamage(x, y, 72, 55)
    w.effects.add(crack(x, y, { branches: 6, len: 96 }))
    w.effects.add(speedLines(x, y, { count: 8, r0: 8, r1: 80 }))
    fx.debris(w.particles, x, y, 14, EARTH)
    fx.dust(w.particles, x, y, 8)
    w.camera.shake(11)
    w.camera.punch(0.02)
    w.audio.play('thud')
  },
}

const fist: Weapon = {
  id: 'fist',
  name: '주먹',
  icon: '👊',
  mode: 'point',
  apply(w, x, y) {
    w.target.takeDamage(x, y, 104, 72)
    w.effects.add(shockwave(x, y, 130, { color: '#ffffff', width: 12 }))
    w.effects.add(crack(x, y, { branches: 8, len: 120 }))
    w.effects.add(speedLines(x, y, { count: 12, r0: 14, r1: 120 }))
    fx.debris(w.particles, x, y, 22, EARTH)
    fx.dust(w.particles, x, y, 12)
    w.camera.shake(17)
    w.camera.punch(0.035)
    w.audio.play('thud')
  },
}

const glass: Weapon = {
  id: 'glass',
  name: '유리',
  icon: '🧊',
  mode: 'point',
  apply(w, x, y) {
    w.target.takeDamage(x, y, 62, 48)
    w.effects.add(crack(x, y, { branches: 7, len: 80, color: '#bfe6ff', dur: 0.6 }))
    fx.glassBits(w.particles, x, y, 18)
    fx.sparks(w.particles, x, y, 6, ['#ffffff', '#dff3ff'])
    w.camera.shake(7)
    w.audio.play('glass')
  },
}

const laser: Weapon = {
  id: 'laser',
  name: '레이저',
  icon: '🔪',
  mode: 'point',
  apply(w, x, y) {
    w.effects.add(beam(x, 0, x, y, { color: '#ff4d6d', core: '#ffffff', width: 14, dur: 0.28 }))
    w.target.takeDamage(x, y, 50, 44)
    fx.sparks(w.particles, x, y, 14, ['#ff4d6d', '#ffd23f', '#ffffff'])
    fx.fireBits(w.particles, x, y, 6)
    w.camera.shake(6)
    w.camera.flash('#ff4d6d', 0.12)
    w.audio.play('zap')
  },
}

const meteor: Weapon = {
  id: 'meteor',
  name: '운석',
  icon: '☄️',
  mode: 'point',
  apply(w, x, y) {
    const sx = x + rng.spread(120)
    w.effects.add(
      projectile(sx, -90, x, y, {
        dur: 0.42,
        color: '#ffae3b',
        headR: 16,
        onImpact: () => {
          w.target.takeDamage(x, y, 118, 85)
          w.effects.add(explosion(x, y, 170))
          w.effects.add(shockwave(x, y, 200, { color: '#ffcaa0', width: 14 }))
          fx.debris(w.particles, x, y, 28, EARTH)
          fx.fireBits(w.particles, x, y, 20)
          fx.smoke(w.particles, x, y, 10)
          fx.dust(w.particles, x, y, 14)
          w.camera.shake(26)
          w.camera.punch(0.05)
          w.camera.flash('#ffd9a0', 0.3)
          w.audio.play('bigboom')
        },
      })
    )
    w.audio.play('whoosh')
  },
}

const missile: Weapon = {
  id: 'missile',
  name: '미사일',
  icon: '🚀',
  mode: 'point',
  apply(w, x, y) {
    const n = 4
    for (let i = 0; i < n; i++) {
      const tx = x + rng.spread(90)
      const ty = y + rng.spread(60)
      w.effects.add(
        projectile(tx + rng.spread(40), -100 - i * 30, tx, ty, {
          dur: 0.4 + i * 0.08,
          color: '#ff5a3c',
          headR: 9,
          onImpact: () => {
            w.target.takeDamage(tx, ty, 70, 60)
            w.effects.add(explosion(tx, ty, 90))
            fx.debris(w.particles, tx, ty, 12, EARTH)
            fx.fireBits(w.particles, tx, ty, 10)
            fx.smoke(w.particles, tx, ty, 5)
            w.camera.shake(14)
            w.audio.play('boom')
          },
        })
      )
    }
    w.audio.play('whoosh')
  },
}

const bomb: Weapon = {
  id: 'bomb',
  name: '대폭발',
  icon: '💣',
  mode: 'point',
  apply(w, x, y) {
    w.target.takeDamage(x, y, 150, 95)
    w.effects.add(explosion(x, y, 210, { dur: 0.6 }))
    w.effects.add(shockwave(x, y, 240, { color: '#ffd9a0', width: 16 }))
    fx.debris(w.particles, x, y, 34, EARTH)
    fx.fireBits(w.particles, x, y, 26)
    fx.smoke(w.particles, x, y, 14)
    fx.dust(w.particles, x, y, 16)
    w.camera.shake(30)
    w.camera.punch(0.06)
    w.camera.flash('#fff1c0', 0.4)
    w.audio.play('bigboom')
  },
}

const lightningBolt: Weapon = {
  id: 'lightning',
  name: '번개',
  icon: '⚡',
  mode: 'point',
  apply(w, x, y) {
    w.effects.add(lightning(x, 0, x, y, { dur: 0.28 }))
    w.target.takeDamage(x, y, 84, 70)
    w.effects.add(crack(x, y, { branches: 5, len: 80, color: '#bfe3ff', dur: 0.5 }))
    fx.sparks(w.particles, x, y, 20, ['#bfe3ff', '#ffffff', '#9fd0ff'])
    fx.debris(w.particles, x, y, 12, EARTH)
    w.camera.shake(16)
    w.camera.flash('#dff0ff', 0.35)
    w.audio.play('zap')
  },
}

const flame: Weapon = {
  id: 'flame',
  name: '화염',
  icon: '🔥',
  mode: 'point',
  apply(w, x, y) {
    w.target.takeDamage(x, y, 56, 36)
    fx.fireBits(w.particles, x, y, 16)
    fx.ash(w.particles, x, y, 8)
    fx.smoke(w.particles, x, y, 6)
    w.effects.add(explosion(x, y, 70, { dur: 0.3, hot: '#ffd23f', cool: '#ff4d2f' }))
    w.camera.shake(5)
    w.audio.play('sizzle')
  },
}

const tornadoWeapon: Weapon = {
  id: 'tornado',
  name: '토네이도',
  icon: '🌪️',
  mode: 'point',
  apply(w, x, y) {
    const top = Math.max(40, y - 220)
    w.effects.add(tornado(x, top, y + 80, { dur: 1.1 }))
    // tear off a vertical band of fragments
    w.target.takeDamage(x, w.target.cy, 130, 55)
    fx.dust(w.particles, x, y, 18)
    fx.debris(w.particles, x, y, 16, EARTH)
    w.camera.shake(12)
    w.audio.play('whoosh')
  },
}

const freeze: Weapon = {
  id: 'freeze',
  name: '빙결',
  icon: '❄️',
  mode: 'point',
  apply(w, x, y) {
    w.effects.add(frostRing(x, y, 110))
    w.target.takeDamage(x, y, 92, 62)
    fx.glassBits(w.particles, x, y, 16)
    fx.sparks(w.particles, x, y, 8, ['#cdebff', '#ffffff', '#eaf7ff'])
    w.camera.shake(9)
    w.camera.flash('#dff2ff', 0.18)
    w.audio.play('freeze')
    w.audio.play('glass')
  },
}

const blackHole: Weapon = {
  id: 'blackhole',
  name: '블랙홀',
  icon: '🕳️',
  mode: 'cinematic',
  apply(w, x, y) {
    w.effects.add(blackhole(x, y, 180, { dur: 1.5 }))
    w.target.detachAll(x, y, 8, 'dissolve')
    // particles spiral inward
    for (let i = 0; i < 70; i++) {
      const a = rng.angle()
      const d = rng.range(120, 340)
      const px = x + Math.cos(a) * d
      const py = y + Math.sin(a) * d
      const sp = rng.range(160, 380)
      w.particles.spawn({
        x: px,
        y: py,
        vx: -Math.cos(a) * sp,
        vy: -Math.sin(a) * sp,
        life: d / sp,
        size: rng.range(1.5, 3.5),
        color: rng.pick(['#b06bff', '#7fd0ff', '#ffffff', '#c9a3e8']),
        kind: 'spark',
        drag: 0.2,
      })
    }
    w.camera.shake(10)
    w.audio.play('whoosh')
    w.audio.play('boom')
  },
}

export const elementalWeapons: Weapon[] = [
  hammer,
  fist,
  glass,
  laser,
  meteor,
  missile,
  bomb,
  lightningBolt,
  flame,
  tornadoWeapon,
  freeze,
  blackHole,
]
