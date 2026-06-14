import { C, INK } from './palette'

/** Big bubbly "세상" text filling the sprite. */
export function drawWord(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const text = '세상'
  const fontSize = Math.min(h * 0.92, w * 0.5)
  ctx.font = `900 ${fontSize}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = w / 2
  const cy = h / 2

  // soft shadow
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillText(text, cx + 6, cy + 8)
  ctx.restore()

  // thick ink outline
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.lineWidth = fontSize * 0.14
  ctx.strokeText(text, cx, cy)

  // bright fill with vertical gradient
  const g = ctx.createLinearGradient(0, cy - fontSize / 2, 0, cy + fontSize / 2)
  g.addColorStop(0, C.fireHot)
  g.addColorStop(1, C.fire)
  ctx.fillStyle = g
  ctx.fillText(text, cx, cy)

  // glossy top highlight
  ctx.save()
  ctx.globalAlpha = 0.25
  ctx.fillStyle = C.white
  ctx.fillText(text, cx, cy - fontSize * 0.06)
  ctx.restore()
}
