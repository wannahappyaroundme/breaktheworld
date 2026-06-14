import { C, INK } from './palette'
import { dCircle, dEllipse, dPoly, dot, smile, blushDot } from './doodle'

/**
 * Each character draws centered on (cx,cy) using absolute coords, sized so its
 * overall height ≈ s. Apply a transform around (cx,cy) for squash/scale poses.
 */

export function drawCinnamoroll(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.34
  // ears
  dEllipse(ctx, cx - r * 1.0, cy + r * 0.5, r * 0.7, r * 1.7, { fill: C.white, strokeWidth: 3, seed: 2 })
  dEllipse(ctx, cx + r * 1.0, cy + r * 0.5, r * 0.7, r * 1.7, { fill: C.white, strokeWidth: 3, seed: 3 })
  // body
  dEllipse(ctx, cx, cy + r * 1.1, r * 1.5, r * 1.3, { fill: C.white, strokeWidth: 3, seed: 9 })
  // head
  dCircle(ctx, cx, cy, r * 2, { fill: C.white, strokeWidth: 3.5, seed: 4 })
  // tuft
  dEllipse(ctx, cx, cy - r * 1.05, r * 0.5, r * 0.4, { fill: C.white, strokeWidth: 2.5, seed: 6 })
  // face
  dot(ctx, cx - r * 0.42, cy - r * 0.05, r * 0.12, INK)
  dot(ctx, cx + r * 0.42, cy - r * 0.05, r * 0.12, INK)
  blushDot(ctx, cx - r * 0.62, cy + r * 0.28, r * 0.18, C.blush)
  blushDot(ctx, cx + r * 0.62, cy + r * 0.28, r * 0.18, C.blush)
  smile(ctx, cx, cy + r * 0.05, r * 0.22, INK, 3)
}

export function drawThanos(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.3
  // head
  dCircle(ctx, cx, cy - r * 0.4, r * 1.8, { fill: C.purple, strokeWidth: 3.5, seed: 12 })
  // chin
  dEllipse(ctx, cx, cy + r * 0.4, r * 1.3, r * 1.1, { fill: C.purple, strokeWidth: 3, seed: 13 })
  // brow
  ctx.strokeStyle = INK
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.7, cy - r * 0.55)
  ctx.lineTo(cx - r * 0.15, cy - r * 0.3)
  ctx.moveTo(cx + r * 0.7, cy - r * 0.55)
  ctx.lineTo(cx + r * 0.15, cy - r * 0.3)
  ctx.stroke()
  dot(ctx, cx - r * 0.42, cy - r * 0.22, r * 0.1, INK)
  dot(ctx, cx + r * 0.42, cy - r * 0.22, r * 0.1, INK)
  // grimace
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.4, cy + r * 0.55)
  ctx.lineTo(cx + r * 0.4, cy + r * 0.55)
  ctx.stroke()
}

/** The golden Infinity Gauntlet mid-snap. */
export function drawGauntlet(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.5
  dEllipse(ctx, cx, cy, r * 1.5, r * 1.7, { fill: C.ironGold, strokeWidth: 3.5, seed: 31 })
  // fingers (snapping pose)
  dEllipse(ctx, cx - r * 0.5, cy - r * 0.9, r * 0.4, r * 0.8, { fill: C.ironGold, strokeWidth: 3, seed: 32 })
  dEllipse(ctx, cx + r * 0.55, cy - r * 0.6, r * 0.45, r * 0.6, { fill: C.ironGold, strokeWidth: 3, seed: 33 })
  // gems
  const gems = ['#ffd23f', '#9b6cd6', '#e23b3b', '#4aa6e0', '#7cc95a', '#ff9f1c']
  gems.forEach((g, i) => {
    const a = -1.2 + i * 0.45
    dot(ctx, cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.16, g)
  })
}

export function drawIronman(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.3
  // body
  dEllipse(ctx, cx, cy + r * 1.3, r * 1.4, r * 1.7, { fill: C.ironRed, strokeWidth: 3, seed: 41 })
  // arc reactor
  dot(ctx, cx, cy + r * 1.0, r * 0.28, '#bff0ff')
  dot(ctx, cx, cy + r * 1.0, r * 0.16, '#ffffff')
  // helmet
  dCircle(ctx, cx, cy, r * 1.7, { fill: C.ironRed, strokeWidth: 3.5, seed: 42 })
  // faceplate
  dPoly(
    ctx,
    [
      [cx - r * 0.6, cy - r * 0.2],
      [cx + r * 0.6, cy - r * 0.2],
      [cx + r * 0.45, cy + r * 0.7],
      [cx - r * 0.45, cy + r * 0.7],
    ],
    { fill: C.ironGold, strokeWidth: 3, seed: 43 }
  )
  // eyes
  ctx.fillStyle = '#dffaff'
  ctx.fillRect(cx - r * 0.45, cy - r * 0.02, r * 0.3, r * 0.12)
  ctx.fillRect(cx + r * 0.15, cy - r * 0.02, r * 0.3, r * 0.12)
}

export function drawHulk(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.3
  // torso
  dPoly(
    ctx,
    [
      [cx - r * 1.5, cy + r * 1.8],
      [cx - r * 1.2, cy + r * 0.2],
      [cx + r * 1.2, cy + r * 0.2],
      [cx + r * 1.5, cy + r * 1.8],
    ],
    { fill: C.hulkGreen, strokeWidth: 3.5, seed: 51 }
  )
  // fists
  dCircle(ctx, cx - r * 1.7, cy + r * 0.4, r * 0.9, { fill: C.hulkGreen2, strokeWidth: 3, seed: 52 })
  dCircle(ctx, cx + r * 1.7, cy + r * 0.4, r * 0.9, { fill: C.hulkGreen2, strokeWidth: 3, seed: 53 })
  // head
  dCircle(ctx, cx, cy - r * 0.5, r * 1.3, { fill: C.hulkGreen, strokeWidth: 3.5, seed: 54 })
  // angry brow
  ctx.strokeStyle = INK
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.55, cy - r * 0.75)
  ctx.lineTo(cx - r * 0.1, cy - r * 0.5)
  ctx.moveTo(cx + r * 0.55, cy - r * 0.75)
  ctx.lineTo(cx + r * 0.1, cy - r * 0.5)
  ctx.stroke()
  dot(ctx, cx - r * 0.32, cy - r * 0.42, r * 0.1, INK)
  dot(ctx, cx + r * 0.32, cy - r * 0.42, r * 0.1, INK)
  // shouting mouth
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.ellipse(cx, cy - r * 0.1, r * 0.35, r * 0.22, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function drawGodzilla(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.3
  // body
  dEllipse(ctx, cx, cy + r * 0.6, r * 1.6, r * 2.4, { fill: C.godzilla, strokeWidth: 3.5, seed: 61 })
  // head
  dEllipse(ctx, cx + r * 0.2, cy - r * 1.2, r * 1.5, r * 1.1, { fill: C.godzilla, strokeWidth: 3, seed: 62 })
  // dorsal plates
  for (let i = 0; i < 5; i++) {
    const yy = cy - r * 0.6 + i * r * 0.55
    dPoly(
      ctx,
      [
        [cx - r * 1.3, yy],
        [cx - r * 1.9, yy - r * 0.45],
        [cx - r * 1.1, yy - r * 0.2],
      ],
      { fill: C.godzilla2, strokeWidth: 2.5, seed: 70 + i }
    )
  }
  // open mouth
  dPoly(
    ctx,
    [
      [cx + r * 0.7, cy - r * 1.3],
      [cx + r * 1.7, cy - r * 1.35],
      [cx + r * 1.5, cy - r * 0.85],
    ],
    { fill: '#3a1010', strokeWidth: 2.5, seed: 66 }
  )
  dot(ctx, cx + r * 0.4, cy - r * 1.45, r * 0.1, INK)
}

export function drawSaiyan(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.3
  // body
  dEllipse(ctx, cx, cy + r * 1.2, r * 1.1, r * 1.6, { fill: '#ff8a3c', strokeWidth: 3, seed: 81 })
  // head
  dCircle(ctx, cx, cy, r * 1.3, { fill: '#ffd9b0', strokeWidth: 3, seed: 82 })
  // spiky hair
  const spikes: [number, number][] = []
  const n = 9
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI
    const rr = i % 2 ? r * 1.5 : r * 0.95
    spikes.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr - r * 0.2])
  }
  spikes.push([cx + r * 0.9, cy - r * 0.1])
  spikes.push([cx - r * 0.9, cy - r * 0.1])
  dPoly(ctx, spikes, { fill: C.saiyan, strokeWidth: 3, seed: 83 })
  // face
  dot(ctx, cx - r * 0.35, cy + r * 0.1, r * 0.09, INK)
  dot(ctx, cx + r * 0.35, cy + r * 0.1, r * 0.09, INK)
  // hands cupped (energy held to the side)
  dCircle(ctx, cx + r * 1.3, cy + r * 1.0, r * 0.5, { fill: '#ffd9b0', strokeWidth: 2.5, seed: 84 })
}

export function drawCat(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.34
  // body (chubby)
  dEllipse(ctx, cx, cy + r * 0.6, r * 1.7, r * 1.7, { fill: C.catGray, strokeWidth: 3, seed: 91 })
  // ears
  dPoly(ctx, [[cx - r * 0.8, cy - r * 0.7], [cx - r * 1.1, cy - r * 1.3], [cx - r * 0.35, cy - r * 1.0]], {
    fill: C.catGray,
    strokeWidth: 2.5,
    seed: 92,
  })
  dPoly(ctx, [[cx + r * 0.8, cy - r * 0.7], [cx + r * 1.1, cy - r * 1.3], [cx + r * 0.35, cy - r * 1.0]], {
    fill: C.catGray,
    strokeWidth: 2.5,
    seed: 93,
  })
  // head
  dCircle(ctx, cx, cy - r * 0.2, r * 1.6, { fill: C.catGray, strokeWidth: 3, seed: 94 })
  // face
  dot(ctx, cx - r * 0.4, cy - r * 0.25, r * 0.11, INK)
  dot(ctx, cx + r * 0.4, cy - r * 0.25, r * 0.11, INK)
  blushDot(ctx, cx - r * 0.62, cy + r * 0.05, r * 0.16, C.blush)
  blushDot(ctx, cx + r * 0.62, cy + r * 0.05, r * 0.16, C.blush)
  // nose + whiskers
  dot(ctx, cx, cy - r * 0.02, r * 0.08, '#ff8aa0')
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.3, cy + r * 0.05)
  ctx.lineTo(cx - r * 0.9, cy - r * 0.05)
  ctx.moveTo(cx + r * 0.3, cy + r * 0.05)
  ctx.lineTo(cx + r * 0.9, cy - r * 0.05)
  ctx.stroke()
}

export function drawDitto(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.42
  // blobby body
  dPoly(
    ctx,
    [
      [cx - r * 1.3, cy + r * 0.9],
      [cx - r * 1.4, cy - r * 0.1],
      [cx - r * 0.6, cy - r * 0.9],
      [cx + r * 0.5, cy - r * 0.85],
      [cx + r * 1.35, cy - r * 0.2],
      [cx + r * 1.45, cy + r * 0.7],
      [cx + r * 0.6, cy + r * 1.05],
      [cx - r * 0.5, cy + r * 1.05],
    ],
    { fill: C.dittoPurple, strokeWidth: 3.5, roughness: 1.6, seed: 101 }
  )
  // classic ditto face
  dot(ctx, cx - r * 0.4, cy, r * 0.1, INK)
  dot(ctx, cx + r * 0.4, cy, r * 0.1, INK)
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.25, cy + r * 0.35)
  ctx.quadraticCurveTo(cx, cy + r * 0.5, cx + r * 0.25, cy + r * 0.35)
  ctx.stroke()
}

export function drawPooh(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.32
  // body
  dEllipse(ctx, cx, cy + r * 1.2, r * 1.5, r * 1.6, { fill: C.poohYellow, strokeWidth: 3, seed: 111 })
  // red shirt
  dPoly(
    ctx,
    [
      [cx - r * 1.1, cy + r * 0.7],
      [cx + r * 1.1, cy + r * 0.7],
      [cx + r * 0.95, cy + r * 1.4],
      [cx - r * 0.95, cy + r * 1.4],
    ],
    { fill: C.poohRed, strokeWidth: 2.5, seed: 112 }
  )
  // ears
  dCircle(ctx, cx - r * 0.85, cy - r * 0.85, r * 0.6, { fill: C.poohYellow, strokeWidth: 2.5, seed: 113 })
  dCircle(ctx, cx + r * 0.85, cy - r * 0.85, r * 0.6, { fill: C.poohYellow, strokeWidth: 2.5, seed: 114 })
  // head
  dCircle(ctx, cx, cy, r * 1.5, { fill: C.poohYellow, strokeWidth: 3, seed: 115 })
  // snout
  dEllipse(ctx, cx, cy + r * 0.35, r * 0.7, r * 0.5, { fill: '#ffdf80', strokeWidth: 2, seed: 116 })
  dot(ctx, cx, cy + r * 0.2, r * 0.12, INK)
  dot(ctx, cx - r * 0.4, cy - r * 0.15, r * 0.09, INK)
  dot(ctx, cx + r * 0.4, cy - r * 0.15, r * 0.09, INK)
}

/** A little honey pot for Pooh's attack. */
export function drawHoneyPot(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.5
  dPoly(
    ctx,
    [
      [cx - r, cy - r * 0.6],
      [cx + r, cy - r * 0.6],
      [cx + r * 0.7, cy + r * 0.8],
      [cx - r * 0.7, cy + r * 0.8],
    ],
    { fill: '#caa15a', strokeWidth: 3, seed: 121 }
  )
  dEllipse(ctx, cx, cy - r * 0.6, r * 2.2, r * 0.5, { fill: '#a8823f', strokeWidth: 3, seed: 122 })
  ctx.fillStyle = INK
  ctx.font = `900 ${r * 0.7}px system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('HUNNY', cx, cy + r * 0.15)
}
