import { C, INK } from './palette'
import { dCircle, dPath } from './doodle'

/** Smooth closed path (Catmull-Rom -> cubic bezier) through normalized points. */
function smoothPath(cx: number, cy: number, R: number, pts: [number, number][]): string {
  const abs = pts.map(([nx, ny]) => [cx + nx * R, cy + ny * R] as [number, number])
  const n = abs.length
  let d = `M ${abs[0][0].toFixed(1)} ${abs[0][1].toFixed(1)} `
  for (let i = 0; i < n; i++) {
    const p0 = abs[(i - 1 + n) % n]
    const p1 = abs[i]
    const p2 = abs[(i + 1) % n]
    const p3 = abs[(i + 2) % n]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `
  }
  return d + 'Z'
}

/** Cute doodle planet earth with organic continents filling the sprite. */
export function drawEarth(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) / 2 - 8

  // ocean
  dCircle(ctx, cx, cy, R * 2, { fill: C.ocean, strokeWidth: 4, roughness: 1.05, seed: 7 })

  // clip continents to the planet disc
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R - 2, 0, Math.PI * 2)
  ctx.clip()

  // organic continents (normalized anchor loops)
  const continents: { pts: [number, number][]; fill: string; seed: number }[] = [
    {
      pts: [
        [-0.5, -0.45],
        [-0.15, -0.62],
        [0.12, -0.4],
        [0.05, -0.08],
        [-0.22, 0.02],
        [-0.52, -0.12],
      ],
      fill: C.land,
      seed: 11,
    },
    {
      pts: [
        [0.18, -0.1],
        [0.5, -0.22],
        [0.62, 0.12],
        [0.4, 0.45],
        [0.12, 0.3],
      ],
      fill: C.land2,
      seed: 12,
    },
    {
      pts: [
        [-0.55, 0.2],
        [-0.28, 0.16],
        [-0.18, 0.45],
        [-0.42, 0.6],
        [-0.62, 0.42],
      ],
      fill: C.land,
      seed: 13,
    },
  ]
  for (const cont of continents) {
    dPath(ctx, smoothPath(cx, cy, R, cont.pts), {
      fill: cont.fill,
      strokeWidth: 3,
      roughness: 1.1,
      seed: cont.seed,
    })
  }
  // a little ice cap
  dPath(
    ctx,
    smoothPath(cx, cy, R, [
      [-0.2, -0.85],
      [0.2, -0.85],
      [0.15, -0.62],
      [-0.15, -0.62],
    ]),
    { fill: C.white, strokeWidth: 2.2, roughness: 1, seed: 14 }
  )
  ctx.restore()

  // glossy highlight
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = C.white
  ctx.beginPath()
  ctx.ellipse(cx - R * 0.34, cy - R * 0.4, R * 0.42, R * 0.24, -0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // crisp planet outline on top
  ctx.strokeStyle = INK
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
}
