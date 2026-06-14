import rough from 'roughjs'
import type { RoughCanvas } from 'roughjs/bin/canvas'
import { INK } from './palette'

const rcCache = new WeakMap<HTMLCanvasElement, RoughCanvas>()

export function rc(ctx: CanvasRenderingContext2D): RoughCanvas {
  let r = rcCache.get(ctx.canvas)
  if (!r) {
    r = rough.canvas(ctx.canvas)
    rcCache.set(ctx.canvas, r)
  }
  return r
}

export interface DoodleOpts {
  fill?: string
  stroke?: string
  strokeWidth?: number
  roughness?: number
  fillStyle?: string
  seed?: number
  bowing?: number
}

function opts(o: DoodleOpts = {}) {
  return {
    fill: o.fill,
    fillStyle: o.fillStyle ?? 'solid',
    stroke: o.stroke ?? (o.fill ? INK : INK),
    strokeWidth: o.strokeWidth ?? 3,
    roughness: o.roughness ?? 1.15,
    bowing: o.bowing ?? 1,
    seed: o.seed ?? 1,
  }
}

export function dCircle(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, o?: DoodleOpts) {
  rc(ctx).circle(x, y, d, opts(o))
}

export function dEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o?: DoodleOpts
) {
  rc(ctx).ellipse(x, y, w, h, opts(o))
}

export function dPoly(ctx: CanvasRenderingContext2D, pts: [number, number][], o?: DoodleOpts) {
  rc(ctx).polygon(pts, opts(o))
}

export function dPath(ctx: CanvasRenderingContext2D, d: string, o?: DoodleOpts) {
  rc(ctx).path(d, opts(o))
}

export function dLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o?: DoodleOpts
) {
  rc(ctx).line(x1, y1, x2, y2, { ...opts(o), fill: undefined })
}

/** crisp filled circle (faces, eyes) — plain canvas, no sketch */
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** simple smiley arc mouth */
export function smile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  color = INK,
  lw = 3
) {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, w, 0.15 * Math.PI, 0.85 * Math.PI)
  ctx.stroke()
}

/** rosy cheek */
export function blushDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save()
  ctx.globalAlpha = 0.7
  dot(ctx, x, y, r, color)
  ctx.restore()
}
