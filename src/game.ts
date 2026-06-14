import { Renderer } from './engine/renderer'
import { GameLoop } from './engine/loop'
import type { PointerHit } from './engine/input'
import { Input } from './engine/input'
import { Camera } from './engine/camera'
import { Particles } from './engine/particles'
import { Audio } from './engine/audio'
import { Effects } from './effects/manager'
import { TargetManager } from './targets/manager'
import { createEarth } from './targets/earth'
import { createCity } from './targets/city'
import { createWord } from './targets/word'
import { weapons, defaultWeaponId, findWeapon } from './weapons/registry'
import type { Weapon, World } from './weapons/weapon'
import { Hud } from './ui/hud'
import { WeaponBar } from './weapons/bar'

const COMBO_RESET_SEC = 1.6

export class Game {
  private renderer: Renderer
  private camera = new Camera()
  private particles: Particles
  private audio = new Audio()
  private effects = new Effects()
  private manager: TargetManager
  private weapon: Weapon
  private hud: Hud
  private bar: WeaponBar
  private combo = 0
  private comboTimer = 0
  private cinematicCooldown = 0
  private hintHidden = false
  private hintEl: HTMLElement | null

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas)
    const area = this.renderer.width * this.renderer.height
    const cap = area > 900000 ? 1500 : area > 450000 ? 1200 : 900
    this.particles = new Particles(cap)

    this.manager = new TargetManager(
      { factories: [createEarth, createCity, createWord], swapDelaySec: 0.9 },
      this.renderer.width,
      this.renderer.height
    )

    this.weapon = findWeapon(defaultWeaponId)
    this.hud = new Hud(uiRoot, {
      onToggleSound: this.onToggleSound,
      onReset: this.onReset,
      onNext: this.onNext,
    })
    this.bar = new WeaponBar(uiRoot, weapons, (w) => this.selectWeapon(w))
    this.bar.select(this.weapon.id)
    this.hintEl = document.getElementById('tap-hint')

    new Input(canvas, (hit) => this.onHit(hit))
    window.addEventListener('resize', () =>
      this.manager.current.reposition(this.renderer.width, this.renderer.height)
    )

    new GameLoop((dtMs) => this.frame(dtMs)).start()

    if (location.search.includes('demo')) this.runDemo()
  }

  /** Auto-fire a weapon around the target (for screenshots/demos: ?demo or ?demo=thanos). */
  private runDemo(): void {
    const m = location.search.match(/demo=([a-z]+)/)
    if (m) {
      const wpn = findWeapon(m[1])
      this.selectWeapon(wpn)
    }
    const offsets = [
      [-50, -30],
      [40, 10],
      [-10, 45],
      [55, -25],
      [0, -5],
      [-55, 25],
      [25, -45],
    ]
    offsets.forEach((o, i) => {
      window.setTimeout(() => {
        const t = this.manager.current
        if (!this.hintHidden) {
          this.hintHidden = true
          this.hintEl?.classList.add('hidden')
        }
        this.weapon.apply(this.world(), t.cx + o[0], t.cy + o[1])
        this.addCombo()
      }, 150 + i * 170)
    })
  }

  private selectWeapon(w: Weapon): void {
    this.weapon = w
    this.bar.select(w.id)
    this.hud.flashWeapon(w.name)
    this.audio.unlock()
  }

  private world(): World {
    return {
      target: this.manager.current,
      particles: this.particles,
      effects: this.effects,
      camera: this.camera,
      audio: this.audio,
      w: this.renderer.width,
      h: this.renderer.height,
    }
  }

  private onHit(hit: PointerHit): void {
    this.audio.unlock()
    if (!this.hintHidden) {
      this.hintHidden = true
      this.hintEl?.classList.add('hidden')
    }
    const w = this.weapon
    if (w.mode === 'cinematic') {
      if (hit.phase !== 'down' || this.cinematicCooldown > 0) return
      this.cinematicCooldown = w.cooldown ?? 0.9
    }
    w.apply(this.world(), hit.x, hit.y)
    this.addCombo()
  }

  private addCombo(): void {
    this.combo++
    this.comboTimer = COMBO_RESET_SEC
    this.hud.setCombo(this.combo)
  }

  private frame(dtMs: number): void {
    const dt = dtMs / 1000
    if (this.cinematicCooldown > 0) this.cinematicCooldown = Math.max(0, this.cinematicCooldown - dt)
    if (this.comboTimer > 0) {
      this.comboTimer -= dt
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.combo = 0
        this.hud.setCombo(0)
      }
    }

    this.camera.update(dtMs)
    this.particles.update(dt, this.renderer.width, this.renderer.height)
    this.effects.update(dt)
    this.manager.update(dt, this.renderer.width, this.renderer.height)

    const ctx = this.renderer.ctx
    this.camera.setCenter(this.renderer.cx, this.renderer.cy)
    this.renderer.clear()
    this.camera.begin(ctx)
    this.effects.drawBelow(ctx)
    this.manager.current.draw(ctx)
    this.particles.draw(ctx)
    this.effects.drawAbove(ctx)
    this.camera.end(ctx)
    this.camera.overlay(ctx, this.renderer.width, this.renderer.height)
  }

  private onToggleSound = (): void => {
    this.audio.unlock()
    this.hud.setMuted(this.audio.toggleMute())
  }

  private onReset = (): void => {
    this.manager.reset(this.renderer.width, this.renderer.height)
    this.combo = 0
    this.hud.setCombo(0)
    this.effects.clear()
    this.particles.clear()
  }

  private onNext = (): void => {
    this.manager.skip(this.renderer.width, this.renderer.height)
  }
}
