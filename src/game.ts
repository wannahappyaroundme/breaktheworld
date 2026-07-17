import { Renderer } from './engine/renderer'
import { GameLoop } from './engine/loop'
import { Input } from './engine/input'
import type { GestureEvent } from './combat/gesture'
import { ActionController, type CancelReason } from './combat/action-controller'
import { ChargeVisual } from './combat/charge-visual'
import { Camera } from './engine/camera'
import { Particles } from './engine/particles'
import { Audio } from './engine/audio'
import { Effects } from './effects/manager'
import { TargetManager } from './targets/manager'
import { createEarth } from './targets/earth'
import { createCity } from './targets/city'
import { createWord } from './targets/word'
import { createWeaponRoster, defaultWeaponId, findWeapon } from './weapons/registry'
import type { Weapon, World } from './weapons/weapon'
import type { CharacterSkinId, SkinnableCharacterId } from './art/assets'
import type { Target } from './targets/target'
import { glassBits, confetti, smoke } from './weapons/fx'
import { Hud } from './ui/hud'
import { WhatsNew } from './ui/whatsnew'
import { shareCard } from './ui/sharecard'
import { WeaponBar } from './weapons/bar'
import { OneTimeHoldHint } from './ui/hold-hint'
import {
  GameplayProgressBridge,
  GameProgressCoordinator,
  KNOWN_MOVE_IDS,
  KNOWN_WEAPON_IDS,
  TargetDestroyAttribution,
  createLazyStorageAdapter,
  createMemoryFallbackHandler,
  progressTargetId,
  type ProgressPersistence,
} from './game-progress'
import { BUILT_IN_CATALOG } from './progress/catalog'
import { kstDayKey } from './progress/day'
import type { EventSource, GameEvent } from './progress/events'
import type { ProgressStateV1 } from './progress/types'
import {
  ProgressStore,
  progressStorageKey,
  type CheckpointReason,
  type StorageAdapter,
} from './progress/store'
import { makeRecordBookView } from './progress/view-model'
import { RecordBook } from './ui/recordbook'
import type { RecordBookSettingChange, RecordBookSettingsState } from './ui/settings'
import {
  RemoteConfigOrchestrator,
  type AnalyticsDisabledHook,
  type FeatureFlags,
} from './config/feature-flags'
import type {
  RemoteConfigResult,
  RemoteQuestConfigProvider,
} from './config/quest-provider'
import {
  AnalyticsClient,
  type AnalyticsSupabaseClient,
} from './analytics/client'
import { GameAnalyticsBridge } from './analytics/game-bridge'
import type { PlayerAccountSnapshot } from './player/controller'
import type { PlayerProgressScope, ProfileCardView } from './player/types'

const COMBO_RESET_SEC = 1.6
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

export interface GameOptions {
  onOpenProfile?: (trigger: HTMLButtonElement) => void
  onFeatureFlags?: (flags: FeatureFlags) => void
  autoShowWhatsNew?: boolean
}

const HIDDEN_PLAYER_ACCOUNT: PlayerAccountSnapshot = {
  kind: 'guest',
  signupEnabled: false,
  card: { visible: false, kind: 'hidden' },
}

export class Game {
  private renderer: Renderer
  private camera = new Camera()
  private particles: Particles
  private audio = new Audio()
  private effects = new Effects()
  private manager: TargetManager
  private controller: ActionController
  private input: Input
  private chargeVisual: ChargeVisual
  private weaponRoster: Weapon[]
  private weapon: Weapon
  private hud: Hud
  private whatsNew: WhatsNew
  private progress!: GameProgressCoordinator
  private progressBridge: GameplayProgressBridge
  private recordBook: RecordBook
  private motionQuery: MediaQueryList
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
  private holdHint: OneTimeHoldHint
  private demoMode = false
  private destroyAttribution = new TargetDestroyAttribution()
  private remoteConfig = new RemoteConfigOrchestrator()
  private analytics = new GameAnalyticsBridge(false)
  private questCatalogResolved = false
  private readonly progressStorage: StorageAdapter = createLazyStorageAdapter()
  private progressFallback: () => void = () => {}
  private progressScopeGeneration = 0
  private progressScopeIdentity = 'guest'
  private progressScopeRevision = 0
  private playerAccount: PlayerAccountSnapshot = HIDDEN_PLAYER_ACCOUNT
  private analyticsInstallSeed = ''

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly options: GameOptions = {},
  ) {
    this.renderer = new Renderer(canvas)
    const area = this.renderer.width * this.renderer.height
    const cap = area > 900000 ? 1500 : area > 450000 ? 1200 : 900
    this.particles = new Particles(cap)

    // 세상 → 지구 → 도시 → (반복), 각 타겟은 하늘에서 떨어져 등장
    this.manager = new TargetManager(
      {
        factories: [createWord, createEarth, createCity],
        swapDelaySec: 0.8,
        onDestroyed: (t) => this.handleDestroyed(t),
        onSpawn: (t) => this.handleSpawn(t),
      },
      this.renderer.width,
      this.renderer.height
    )

    this.whatsNew = new WhatsNew(uiRoot)
    this.hud = new Hud(uiRoot, {
      onToggleSound: this.onToggleSound,
      onReset: this.onReset,
      onNext: this.onNext,
      onWhatsNew: () => this.whatsNew.open(),
      onOpenRecordBook: this.onOpenRecordBook,
      onShare: this.onShare,
    })
    this.progressFallback = createMemoryFallbackHandler((notice) => this.hud.notify(notice))
    this.progress = this.createProgress(this.createProgressStoreForScope({ kind: 'guest' }))
    this.analyticsInstallSeed = this.progress.state.installSeed
    this.best = this.progress.state.lifetime.bestCombo
    this.totalTargets = this.progress.state.lifetime.totalTargets
    this.weaponRoster = createWeaponRoster(
      (characterId) => this.selectedCharacterSkin(characterId),
      () => this.remoteConfig.active.character_variants_enabled
    )
    this.weapon = findWeapon(defaultWeaponId, this.weaponRoster)
    this.progressBridge = new GameplayProgressBridge({
      dispatch: (events, reason) => this.dispatch(events, reason),
      getSource: () => this.demoMode ? 'demo' : 'user',
      onDamageFeedback: (resolution, source) => {
        this.addCombo(source)
        if (source === 'user') this.holdHint.onDamage(resolution)
        return this.combo
      },
      onUserDestroyed: (targetRunId, golden) => {
        this.destroyAttribution.record(targetRunId)
        if (!golden) return null
        for (let i = 0; i < 5; i++) this.addCombo('user')
        return this.combo
      },
    })
    this.controller = new ActionController({
      getTarget: () => this.manager.current,
      getTargetRunId: () => this.manager.targetRunId,
      strongInput: this.progress.state.profile.strongInput,
      onDamage: (resolution) => this.progressBridge.onDamage(resolution),
      onDestroyed: (resolution) => this.progressBridge.onDestroyed(
        resolution,
        progressTargetId(this.manager.current.name),
        this.manager.current.isGolden
      ),
      onSettled: (resolution) => {
        this.remoteConfig.rememberAction(resolution.actionId, resolution.targetRunId)
        this.progressBridge.onSettled(resolution)
        this.applyPendingRemoteConfig()
      },
    })
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.chargeVisual = new ChargeVisual(this.effectiveReducedMotion())
    this.recordBook = new RecordBook(
      uiRoot,
      makeRecordBookView(this.progress.state, this.progress.questCatalog),
      this.settingsState(),
      {
        onTitleChange: (title) => {
          if (this.progress.selectTitle(title)) this.refreshProgressUI()
        },
        onSkinChange: (characterId, skinId) => {
          if (this.progress.selectSkin(characterId, skinId)) this.refreshProgressUI()
        },
        onSettingChange: (change) => this.changeSetting(change),
        onOpenProfile: (trigger) => this.options.onOpenProfile?.(trigger),
        onClose: () => {
          if (this.progress.markAchievementsSeen()) this.refreshProgressUI()
        },
      },
      this.profileCard(),
    )
    const onMotionPreferenceChange = () => this.applyMotionSetting()
    if (typeof this.motionQuery.addEventListener === 'function') {
      this.motionQuery.addEventListener('change', onMotionPreferenceChange)
    } else {
      this.motionQuery.addListener(onMotionPreferenceChange)
    }
    this.applyMotionSetting()
    this.hud.setBest(this.best)
    this.bar = new WeaponBar(uiRoot, this.weaponRoster, (w) => this.selectWeapon(w))
    this.bar.select(this.weapon.id)
    this.holdHint = new OneTimeHoldHint(document.getElementById('tap-hint'))
    if (this.options.autoShowWhatsNew !== false) this.maybeShowWhatsNewOnLoad()

    this.input = new Input(canvas, (event) => this.onGesture(event), 'gesture')
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.cancelAction('visibility')
        this.applyPendingRemoteConfig()
      } else {
        this.applyPendingRemoteConfig()
        this.ensureCurrentDay()
      }
    })
    window.addEventListener('pagehide', () => {
      this.progress.checkpoint('pagehide')
      this.analytics.flushOnPageHide()
    })
    window.addEventListener('resize', () =>
      this.manager.current.reposition(this.renderer.width, this.renderer.height)
    )

    new GameLoop((dtMs) => this.frame(dtMs)).start()

    this.demoMode = location.search.includes('demo')
    if (this.demoMode) this.runDemo()
    if (location.search.includes('fever')) {
      window.setTimeout(() => this.enterFever('system'), 700)
    }
  }

  maybeShowWhatsNewOnLoad(): boolean {
    if (location.search.includes('nonews')) return false
    return this.whatsNew.maybeShowOnLoad()
  }

  setPlayerAccount(snapshot: PlayerAccountSnapshot): void {
    this.playerAccount = snapshot
    this.refreshProgressUI()
  }

  setProgressScope(
    scope: PlayerProgressScope,
    generation: number,
    persistence?: ProgressPersistence,
    revision = 0,
  ): void {
    const identity = scope.kind === 'guest' ? 'guest' : `player:${scope.profile.userId}`
    if (generation < this.progressScopeGeneration) return
    if (generation === this.progressScopeGeneration && identity === this.progressScopeIdentity) return

    this.cancelAction('settingsMode')
    this.progress.checkpoint('scopeChange')
    const next = this.createProgress(persistence ?? this.createProgressStoreForScope(scope))
    this.progress = next
    this.progressScopeGeneration = generation
    this.progressScopeIdentity = identity
    this.progressScopeRevision = revision
    this.combo = 0
    this.recordActive = false
    this.hud.setCombo(0)
    this.controller.setStrongInput(next.state.profile.strongInput)
    this.applyMotionSetting()
    this.refreshProgressUI()
  }

  applyPlayerProjection(input: {
    userId: string
    generation: number
    revision: number
    state: ProgressStateV1
  }): boolean {
    if (this.progressScopeIdentity !== `player:${input.userId}`) return false
    if (this.progressScopeGeneration !== input.generation) return false
    if (input.revision < this.progressScopeRevision) return false
    this.cancelAction('settingsMode')
    if (!this.progress.replaceState(input.state)) return false
    this.progressScopeRevision = input.revision
    this.controller.setStrongInput(this.progress.state.profile.strongInput)
    this.applyMotionSetting()
    this.refreshProgressUI()
    return true
  }

  /** Loads optional operations data after the first playable frame and never rejects into boot. */
  async loadRemoteConfig(
    provider: Pick<RemoteQuestConfigProvider, 'loadConfig'>
  ): Promise<RemoteConfigResult['source']> {
    try {
      const result = await provider.loadConfig()
      this.remoteConfig.stage(result)
      this.applyPendingRemoteConfig()
      return result.source
    } catch {
      if (this.progress.setCatalog(BUILT_IN_CATALOG)) {
        this.questCatalogResolved = true
        this.ensureCurrentDay()
      }
      return 'builtIn'
    }
  }

  /** Task 4 can attach its queue stop-and-clear boundary without coupling gameplay to analytics. */
  setAnalyticsDisabledHook(hook: AnalyticsDisabledHook): void {
    this.remoteConfig.setAnalyticsDisabledHook(hook)
  }

  /** Hashes the private install seed before attaching optional anonymous telemetry. */
  async connectAnalytics(supabase: AnalyticsSupabaseClient | null): Promise<void> {
    try {
      const analytics = await AnalyticsClient.create({
        installSeed: this.analyticsInstallSeed,
        supabase,
        enabled: this.remoteConfig.active.analytics_enabled,
        initialValidHits: this.progress.state.lifetime.validHits,
        initialTargets: this.progress.state.lifetime.totalTargets,
      })
      this.analytics.attach(analytics)
      this.setAnalyticsDisabledHook(() => this.analytics.setEnabled(false))
      this.analytics.setEnabled(this.remoteConfig.active.analytics_enabled)
    } catch {
      this.analytics.setEnabled(false)
    }
  }

  /** Auto-fire a weapon around the target (for screenshots/demos: ?demo or ?demo=thanos). */
  private runDemo(): void {
    const m = location.search.match(/demo=([a-z]+)/)
    if (m) {
      const wpn = findWeapon(m[1], this.weaponRoster)
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
    this.holdHint.hideInitial()
    const intervalMs = this.weapon.mode === 'cinematic' ? 1_450 : 170
    offsets.forEach((o, i) => {
      window.setTimeout(() => {
        const t = this.manager.current
        const x = t.cx + o[0]
        const y = t.cy + o[1]
        this.controller.runSystemQuick(this.weapon, this.world(), x, y)
      }, 150 + i * intervalMs)
    })
  }

  private selectedCharacterSkin(characterId: SkinnableCharacterId): CharacterSkinId {
    return this.progress.state.profile.skins[characterId] === 'classic' ? 'classic' : 'default'
  }

  /** The only gameplay entry that may reduce progress or emit gameplay analytics. */
  private dispatch(events: readonly GameEvent[], reason?: CheckpointReason): void {
    if (events.some((event) => event.type === 'SETTING_CHANGED' || event.source === 'user')) {
      this.ensureCurrentDay()
    }
    const previousTotal = this.progress.state.lifetime.totalTargets
    const previousQuestCompletedAt = this.progress.state.daily.completedAt
    const result = this.reduceProgress(events, reason)
    if (result.accepted === 0) return
    this.analytics.trackQuestTransition(
      previousQuestCompletedAt,
      this.progress.state.daily.completedAt,
      'user',
      result.accepted > 0
    )
    this.refreshProgressUI()
    if (
      this.progress.state.lifetime.totalTargets > previousTotal
      && MILESTONES.includes(this.progress.state.lifetime.totalTargets)
    ) {
      this.hud.toast(`🎉 ${this.progress.state.lifetime.totalTargets}번째 파괴 달성!`)
    }
  }

  /** Central feature gate for gameplay and settings checkpoints. */
  private reduceProgress(events: readonly GameEvent[], reason?: CheckpointReason) {
    return this.progress.dispatch(events, reason, {
      gamificationEnabled: this.gamificationFor(events),
    })
  }

  private settingsState(): RecordBookSettingsState {
    const profile = this.progress.state.profile
    return {
      strongInput: profile.strongInput,
      reducedMotion: profile.reducedMotion,
      haptics: profile.haptics,
    }
  }

  createProgressStoreForScope(scope: PlayerProgressScope): ProgressStore {
    const scoped = scope.kind === 'guest'
      ? { storageKey: undefined, migrateLegacy: true }
      : {
          storageKey: progressStorageKey({ kind: 'player', userId: scope.profile.userId }),
          migrateLegacy: false,
        }
    return new ProgressStore(this.progressStorage, {
      ...scoped,
      knownWeaponIds: KNOWN_WEAPON_IDS,
      knownMoveIds: KNOWN_MOVE_IDS,
      onMemoryFallback: this.progressFallback,
    })
  }

  private createProgress(store: ProgressPersistence): GameProgressCoordinator {
    return new GameProgressCoordinator({
      store,
      catalog: this.progress?.questCatalog ?? BUILT_IN_CATALOG,
      dayKey: kstDayKey(new Date()),
      nowIso: () => new Date().toISOString(),
      notify: (notice) => this.hud.notify(notice),
      analytics: this.analytics,
      knownWeaponIds: KNOWN_WEAPON_IDS,
      knownMoveIds: KNOWN_MOVE_IDS,
      gamificationEnabled: (
        this.questCatalogResolved
        && this.remoteConfig.active.gamification_enabled
      ),
      deferDailyAssignment: !this.questCatalogResolved,
      onDailyQuestTransition: (previous, next) => {
        this.analytics.trackQuestTransition(previous, next, 'user', true)
      },
    })
  }

  private profileCard(): ProfileCardView {
    if (this.playerAccount.kind === 'player') return this.playerAccount.card
    return this.remoteConfig.active.player_profiles_ui
      ? this.playerAccount.card
      : { visible: false, kind: 'hidden' }
  }

  private refreshProgressUI(): void {
    this.best = this.progress.state.lifetime.bestCombo
    this.totalTargets = this.progress.state.lifetime.totalTargets
    this.hud.setBest(this.best)
    this.recordBook.render(
      makeRecordBookView(this.progress.state, this.progress.questCatalog),
      this.settingsState(),
      this.profileCard(),
    )
    this.applyGamificationVisibility()
  }

  private applyGamificationVisibility(): void {
    this.recordBook.setGamificationVisible(this.remoteConfig.active.gamification_enabled)
  }

  private applyPendingRemoteConfig(): void {
    this.remoteConfig.applyIfSettled(this.controller.hasUnsettledAction, {
      applyCatalog: (catalog) => {
        if (!this.progress.setCatalog(catalog)) return
        this.questCatalogResolved = true
      },
      onFlagsApplied: (flags) => {
        this.applyRemoteFlags(flags)
        this.ensureCurrentDay()
      },
    })
  }

  private ensureCurrentDay(): boolean {
    if (!this.questCatalogResolved) return false
    const changed = this.progress.ensureDailyQuest(kstDayKey(new Date()), {
      gamificationEnabled: this.remoteConfig.active.gamification_enabled,
    })
    if (changed) this.refreshProgressUI()
    return changed
  }

  private gamificationFor(events: readonly GameEvent[]): boolean {
    return this.remoteConfig.gamificationFor(events)
  }

  private applyRemoteFlags(flags: FeatureFlags): void {
    this.analytics.setEnabled(flags.analytics_enabled)
    try { this.options.onFeatureFlags?.(flags) } catch { /* player UI remains optional */ }
    this.refreshProgressUI()
  }

  private changeSetting(change: RecordBookSettingChange): void {
    const result = this.reduceProgress([{ type: 'SETTING_CHANGED', ...change }], 'setting')
    if (result.accepted === 0) return
    if (change.key === 'strongInput') {
      const wasCharging = this.controller.chargeState !== null
      const settingChanged = change.value !== this.controller.strongInputMode
      this.controller.setStrongInput(change.value)
      const confirmed = GameAnalyticsBridge.confirmedChargeEnd(
        wasCharging,
        this.controller.chargeState !== null,
        settingChanged
      )
      this.analytics.trackChargeCancellation(confirmed, this.weapon.id, this.currentSource())
    }
    if (change.key === 'reducedMotion') this.applyMotionSetting()
    this.refreshProgressUI()
    this.applyPendingRemoteConfig()
  }

  private effectiveReducedMotion(): boolean {
    return this.progress.state.profile.reducedMotion || this.motionQuery.matches
  }

  private applyMotionSetting(): void {
    const reduced = this.effectiveReducedMotion()
    this.chargeVisual = new ChargeVisual(reduced)
    document.documentElement.classList.toggle('reduce-motion', reduced)
  }

  private selectWeapon(w: Weapon): void {
    this.cancelAction('weaponChange')
    this.applyPendingRemoteConfig()
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

  private onGesture(event: GestureEvent): void {
    if (event.type === 'press') {
      this.audio.unlock()
      this.holdHint.hideInitial()
    }
    const wasCharging = this.controller.chargeState !== null
    const resolution = this.controller.handle(event, this.weapon, this.world())
    const endedCharging = GameAnalyticsBridge.confirmedChargeEnd(
      wasCharging,
      this.controller.chargeState !== null,
      event.type === 'cancel' || (event.type === 'chargeRelease' && resolution?.kind === 'charged')
    )
    if (event.type === 'chargeRelease') {
      this.analytics.trackChargeRelease(endedCharging, this.weapon.id, this.currentSource())
    } else if (event.type === 'cancel') {
      this.analytics.trackChargeCancellation(endedCharging, this.weapon.id, this.currentSource())
    }
    this.applyPendingRemoteConfig()
  }

  private currentSource(): EventSource {
    return this.demoMode ? 'demo' : 'user'
  }

  private cancelAction(reason: CancelReason): void {
    const wasCharging = this.controller.chargeState !== null
    this.controller.cancel(reason)
    const confirmed = GameAnalyticsBridge.confirmedChargeEnd(
      wasCharging,
      this.controller.chargeState !== null,
      true
    )
    this.analytics.trackChargeCancellation(confirmed, this.weapon.id, this.currentSource())
  }

  private haptic(pattern: number | number[]): void {
    if (this.progress.state.profile.haptics && navigator.vibrate) navigator.vibrate(pattern)
  }

  private addCombo(source: EventSource): void {
    this.combo++
    this.comboTimer = COMBO_RESET_SEC
    this.hud.setCombo(this.combo)
    this.haptic(8)

    // FEVER takes priority over a grade flash at the same combo (avoids overlap)
    if (FEVER_AT.includes(this.combo)) {
      this.enterFever(source)
    } else {
      const grade = GRADES.find((g) => g.n === this.combo)
      if (grade) {
        this.hud.gradeFlash(grade.label)
        this.camera.shake(10)
        this.haptic([18, 20, 18])
      }
    }

    if (source === 'user' && this.combo > this.best) {
      this.best = this.combo
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
    this.destroyAttribution.clear()
    this.audio.play('whoosh')
    this.spawnCount++
    // occasional golden bonus target (never the first)
    if (this.spawnCount > 1 && Math.random() < GOLDEN_CHANCE) {
      t.setGolden(true)
      this.hud.toast('✨ 황금 타겟 등장! 부수면 보너스')
    }
  }

  private handleDestroyed(t: Target): void {
    const targetRunId = this.manager.targetRunId
    const attributedToUser = this.destroyAttribution.consume(targetRunId)
    this.cancelAction('targetDestroyed')
    this.applyPendingRemoteConfig()
    this.celebrate(t, attributedToUser)
  }

  /** Enter (or refresh) the sustained FEVER mode at a combo peak. */
  private enterFever(source: EventSource): void {
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
    if (!wasActive) {
      this.dispatch([{ type: 'FEVER_STARTED', source, combo: this.combo }])
      this.manager.current.detachAll(cx, cy, 90, 'fall')
    }
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
  private celebrate(t: Target, attributedToUser: boolean): void {
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

    if (t.isGolden && attributedToUser) {
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
    }
  }

  private frame(dtMs: number): void {
    const nowMs = performance.now()
    this.input.update(nowMs)
    this.controller.update(nowMs)
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
    if (this.comboTimer > 0 && !this.controller.hasComboGrace(nowMs)) {
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
    const chargeState = this.controller.chargeState
    const targetScale = this.chargeVisual.targetScale(chargeState)
    if (targetScale === 1) {
      this.manager.current.draw(ctx)
    } else {
      const target = this.manager.current
      ctx.save()
      ctx.translate(target.cx, target.cy)
      ctx.scale(targetScale, targetScale)
      ctx.translate(-target.cx, -target.cy)
      target.draw(ctx)
      ctx.restore()
    }
    this.particles.draw(ctx)
    this.effects.drawAbove(ctx)
    if (chargeState) this.chargeVisual.draw(ctx, chargeState)
    this.camera.end(ctx)
    this.camera.overlay(ctx, this.renderer.width, this.renderer.height)
    if (this.feverActive) this.drawFever(ctx)
  }

  private onToggleSound = (): void => {
    this.audio.unlock()
    this.hud.setMuted(this.audio.toggleMute())
  }

  private onReset = (): void => {
    this.cancelAction('reset')
    this.applyPendingRemoteConfig()
    this.destroyAttribution.clear()
    this.manager.reset(this.renderer.width, this.renderer.height)
    this.combo = 0
    this.recordActive = false
    this.hud.setCombo(0)
    this.effects.clear()
    this.particles.clear()
  }

  private onNext = (): void => {
    this.cancelAction('next')
    this.applyPendingRemoteConfig()
    this.destroyAttribution.clear()
    this.manager.skip(this.renderer.width, this.renderer.height)
  }

  private onOpenRecordBook = (): void => {
    this.refreshProgressUI()
    this.recordBook.open()
  }

  private onShare = (): void => {
    this.audio.unlock()
    this.hud.toast('📸 카드 만드는 중…')
    void shareCard(
      {
        best: this.best,
        total: this.totalTargets,
        url: location.href.split('?')[0],
        title: this.progress.state.profile.selectedTitle,
        stampFrame: (
          this.remoteConfig.active.gamification_enabled
          && (
            this.progress.state.lifetime.stamps > 0
            || Object.keys(this.progress.state.achievements).length > 0
          )
        ),
      },
      (m) => this.hud.toast(m)
    ).then((result) => {
      if (result.ok) this.dispatch([{ type: 'SHARE_COMPLETED', source: 'user' }])
    }).catch(() => {
      this.hud.toast('잠시 뒤 공유 버튼을 다시 눌러보세요.')
    })
  }
}
