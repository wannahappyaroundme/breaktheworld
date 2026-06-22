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
import type { Target } from './targets/target'
import { glassBits, confetti, smoke } from './weapons/fx'
import { Hud } from './ui/hud'
import { WhatsNew } from './ui/whatsnew'
import { shareCard } from './ui/sharecard'
import { WeaponBar } from './weapons/bar'

const COMBO_RESET_SEC = 1.6
const BEST_KEY = 'btw.bestCombo'
const STATS_KEY = 'btw.totalTargets'
const GRADES: { n: number; label: string }[] = [
  { n: 10, label: 'GREAT!' },
  { n: 20, label: 'SUPER!!' },
  { n: 30, label: 'INSANE!!!' },
  { n: 50, label: 'GODLIKE 🔥' },
  { n: 75, label: 'UNREAL ⚡' },
  { n: 100, label: '🌌 OMG 100' },
]
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
const GOLDEN_CHANCE = 0.18
const FEVER_AT = [30, 60, 100, 150, 200]
const FEVER_DUR = 6

export class Game {
  private renderer: Renderer
  private camera = new Camera()
  private particles: Particles
  private audio = new Audio()
  private effects = new Effects()
  private manager: TargetManager
  private weapon: Weapon
  private hud: Hud
  private whatsNew: WhatsNew
  private bar: WeaponBar
  private combo = 0
  private comboTimer = 0
  private best = 0
  private recordActive = false
  private totalTargets = 0
  private hitStop = 0
  private spawnCount = 0
  private feverActive = false
  private feverTimer = 0
  private feverHue = 0
  private cinematicCooldown = 0
  private hintHidden = false
  private hintEl: HTMLElement | null

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas)
    const area = this.renderer.width * this.renderer.height
    const cap = area > 900000 ? 1500 : area > 450000 ? 1200 : 900
    this.particles = new Particles(cap)

    // 세상 → 지구 → 도시 → (반복), 각 타겟은 하늘에서 떨어져 등장
    this.manager = new TargetManager(
      {
        factories: [createWord, createEarth, createCity],
        swapDelaySec: 0.8,
        onDestroyed: (t) => this.celebrate(t),
        onSpawn: (t) => this.handleSpawn(t),
      },
      this.renderer.width,
      this.renderer.height
    )

    this.best = Number(localStorage.getItem(BEST_KEY) || '0') || 0
    this.totalTargets = Number(localStorage.getItem(STATS_KEY) || '0') || 0
    this.weapon = findWeapon(defaultWeaponId)
    this.whatsNew = new WhatsNew(uiRoot)
    this.hud = new Hud(uiRoot, {
      onToggleSound: this.onToggleSound,
      onReset: this.onReset,
      onNext: this.onNext,
      onWhatsNew: () => this.whatsNew.open(),
      onShare: this.onShare,
    })
    this.hud.setBest(this.best)
    this.bar = new WeaponBar(uiRoot, weapons, (w) => this.selectWeapon(w))
    this.bar.select(this.weapon.id)
    this.hintEl = document.getElementById('tap-hint')
    if (!location.search.includes('nonews')) this.whatsNew.maybeShowOnLoad()

    new Input(canvas, (hit) => this.onHit(hit))
    window.addEventListener('resize', () =>
      this.manager.current.reposition(this.renderer.width, this.renderer.height)
    )

    new GameLoop((dtMs) => this.frame(dtMs)).start()

    if (location.search.includes('demo')) this.runDemo()
    if (location.search.includes('fever')) window.setTimeout(() => this.enterFever(), 700)
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

  private haptic(pattern: number | number[]): void {
    if (navigator.vibrate) navigator.vibrate(pattern)
  }

  private addCombo(): void {
    this.combo++
    this.comboTimer = COMBO_RESET_SEC
    this.hud.setCombo(this.combo)
    this.haptic(8)

    // FEVER takes priority over a grade flash at the same combo (avoids overlap)
    if (FEVER_AT.includes(this.combo)) {
      this.enterFever()
    } else {
      const grade = GRADES.find((g) => g.n === this.combo)
      if (grade) {
        this.hud.gradeFlash(grade.label)
        this.camera.shake(10)
        this.haptic([18, 20, 18])
      }
    }

    if (this.combo > this.best) {
      this.best = this.combo
      localStorage.setItem(BEST_KEY, String(this.best))
      this.hud.setBest(this.best)
      if (!this.recordActive && this.combo >= 5) {
        this.recordActive = true
        this.hud.showNewRecord(this.best)
        this.haptic([40, 30, 40, 30, 90])
        confetti(this.particles, this.renderer.cx, this.renderer.cy * 0.6, 40)
        this.camera.flash('#ffe9a8', 0.3)
      }
    }
  }

  private handleSpawn(t: Target): void {
    this.audio.play('whoosh')
    this.spawnCount++
    // occasional golden bonus target (never the first)
    if (this.spawnCount > 1 && Math.random() < GOLDEN_CHANCE) {
      t.setGolden(true)
      this.hud.toast('✨ 황금 타겟 등장! 부수면 보너스')
    }
  }

  /** Enter (or refresh) the sustained FEVER mode at a combo peak. */
  private enterFever(): void {
    const wasActive = this.feverActive
    this.feverActive = true
    this.feverTimer = FEVER_DUR
    this.hud.setFever(true)
    this.camera.flash('#ff4d9d', 0.45)
    this.camera.shake(34)
    this.camera.punch(0.07)
    this.haptic([60, 40, 60, 40, 120])
    this.audio.play('bigboom')
    this.audio.play('energy')
    const cx = this.renderer.cx
    const cy = this.renderer.cy
    confetti(this.particles, cx, cy, 70)
    this.particles.burst(cx, cy, 50, 'spark', {
      speed: [200, 560],
      life: [0.4, 1.0],
      size: [2, 4],
      colors: ['#ff4d9d', '#ffd23f', '#7fd0ff', '#7cc95a', '#b06bff'],
    })
    // first entry blows the current target apart as a payoff
    if (!wasActive) this.manager.current.detachAll(cx, cy, 90, 'fall')
  }

  /** Rainbow border + tint while FEVER is active. */
  private drawFever(ctx: CanvasRenderingContext2D): void {
    const w = this.renderer.width
    const h = this.renderer.height
    const hue = (this.feverHue * 90) % 360
    const fade = Math.min(1, this.feverTimer) // fade border out in the last second
    ctx.save()
    const rg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72)
    rg.addColorStop(0, 'rgba(0,0,0,0)')
    rg.addColorStop(1, `hsla(${hue}, 100%, 55%, ${0.14 * fade})`)
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 0.85 * fade
    ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`
    ctx.lineWidth = 12
    ctx.strokeRect(6, 6, w - 12, h - 12)
    ctx.restore()
  }

  /** Big satisfying flourish when a target is fully destroyed. */
  private celebrate(t: Target): void {
    const x = t.cx
    const y = t.cy
    glassBits(this.particles, x, y, 36)
    confetti(this.particles, x, y, 28)
    smoke(this.particles, x, y, 8)
    this.camera.flash('#ffffff', 0.28)
    this.camera.shake(22)
    this.camera.punch(0.05)
    this.hitStop = 0.08
    this.haptic([30, 40, 60])
    this.audio.play('glass')
    this.audio.play('bigboom')
    this.hud.popup(t.isGolden ? '💰 골든 잭팟! +5' : `${t.name} 와장창! 💥`)

    if (t.isGolden) {
      this.camera.flash('#ffd23f', 0.4)
      this.haptic([50, 40, 50, 40, 90])
      this.particles.burst(x, y, 44, 'shard', {
        speed: [120, 480],
        life: [0.8, 1.7],
        size: [4, 8],
        colors: ['#ffd23f', '#ffe98a', '#ffb43a', '#fff7d6'],
        gravity: 900,
        drag: 0.4,
      })
      for (let i = 0; i < 5; i++) this.addCombo()
    }

    // cumulative milestone (loss-aversion retention)
    this.totalTargets++
    localStorage.setItem(STATS_KEY, String(this.totalTargets))
    if (MILESTONES.includes(this.totalTargets)) {
      this.hud.toast(`🎉 ${this.totalTargets}번째 파괴 달성!`)
    }
  }

  private frame(dtMs: number): void {
    const realDt = dtMs / 1000
    // hit-stop: briefly slow the world for a punchy "freeze then burst"
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - realDt)
    const scale = this.hitStop > 0 ? 0.15 : 1
    const dt = realDt * scale
    const worldDtMs = dtMs * scale

    // FEVER mode countdown
    if (this.feverActive) {
      this.feverHue += realDt
      this.feverTimer -= realDt
      if (this.feverTimer <= 0) {
        this.feverActive = false
        this.hud.setFever(false)
      }
    }

    // timers run on real time (unaffected by hit-stop)
    if (this.cinematicCooldown > 0) this.cinematicCooldown = Math.max(0, this.cinematicCooldown - realDt)
    if (this.comboTimer > 0) {
      this.comboTimer -= realDt
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.combo = 0
        this.recordActive = false
        this.hud.setCombo(0)
      }
    }

    this.camera.update(worldDtMs)
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
    if (this.feverActive) this.drawFever(ctx)
  }

  private onToggleSound = (): void => {
    this.audio.unlock()
    this.hud.setMuted(this.audio.toggleMute())
  }

  private onReset = (): void => {
    this.manager.reset(this.renderer.width, this.renderer.height)
    this.combo = 0
    this.recordActive = false
    this.hud.setCombo(0)
    this.effects.clear()
    this.particles.clear()
  }

  private onNext = (): void => {
    this.manager.skip(this.renderer.width, this.renderer.height)
  }

  private onShare = (): void => {
    this.audio.unlock()
    this.hud.toast('📸 카드 만드는 중…')
    void shareCard(
      { best: this.best, total: this.totalTargets, url: location.href.split('?')[0] },
      (m) => this.hud.toast(m)
    )
  }
}
