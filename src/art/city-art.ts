import { C, INK } from './palette'
import { dPoly, dCircle } from './doodle'

/** Doodle city skyline filling the sprite (transparent sky). */
export function drawCity(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const ground = h * 0.9
  const buildings = [
    { x: 0.04, w: 0.13, h: 0.55 },
    { x: 0.18, w: 0.1, h: 0.78 },
    { x: 0.29, w: 0.14, h: 0.42 },
    { x: 0.44, w: 0.11, h: 0.92 },
    { x: 0.56, w: 0.13, h: 0.6 },
    { x: 0.7, w: 0.1, h: 0.8 },
    { x: 0.81, w: 0.14, h: 0.5 },
  ]

  buildings.forEach((b, i) => {
    const bx = b.x * w
    const bw = b.w * w
    const bh = b.h * h
    const top = ground - bh
    dPoly(
      ctx,
      [
        [bx, ground],
        [bx, top],
        [bx + bw, top],
        [bx + bw, ground],
      ],
      { fill: i % 2 ? C.building2 : C.building, strokeWidth: 3, roughness: 0.8, seed: 30 + i }
    )
    // windows
    ctx.fillStyle = C.windowOn
    const cols = Math.max(2, Math.floor(bw / 14))
    const rows = Math.max(2, Math.floor(bh / 18))
    const padX = bw / (cols + 1)
    const padY = bh / (rows + 1)
    for (let cI = 1; cI <= cols; cI++) {
      for (let rI = 1; rI <= rows; rI++) {
        if ((cI + rI + i) % 3 === 0) continue
        ctx.fillStyle = (cI + rI) % 2 ? C.windowOn : '#cfe0f5'
        ctx.fillRect(bx + cI * padX - 3, top + rI * padY - 4, 6, 7)
      }
    }
  })

  // ground line
  ctx.strokeStyle = INK
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(2, ground)
  ctx.lineTo(w - 2, ground)
  ctx.stroke()

  // a tiny doodle sun
  dCircle(ctx, w * 0.9, h * 0.12, 34, { fill: C.poohYellow, strokeWidth: 2.5, seed: 5 })
}
