export interface ChargeDrawState {
  x: number
  y: number
  charge: number
  color: string
  maxed: boolean
  nowMs: number
}

const TAU = Math.PI * 2

/** Draws the charge cue directly on the game canvas without DOM or particle work. */
export class ChargeVisual {
  constructor(private readonly reducedMotion: boolean) {}

  draw(ctx: CanvasRenderingContext2D, state: ChargeDrawState): void {
    const pulse = this.reducedMotion ? 0 : Math.sin(state.nowMs / 90) * 2
    const radius = 30 + state.charge * 18 + pulse

    ctx.save()
    ctx.globalAlpha = 0.72 + state.charge * 0.28
    ctx.strokeStyle = state.color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(state.x, state.y, radius, 0, TAU)
    ctx.stroke()

    if (state.maxed) {
      ctx.beginPath()
      ctx.moveTo(state.x, state.y - radius - 7)
      ctx.lineTo(state.x, state.y - radius + 3)
      ctx.stroke()
    }
    ctx.restore()
  }

  targetScale(state: ChargeDrawState | null): number {
    if (!state || this.reducedMotion) return 1
    return 1 + state.charge * 0.03
  }
}
