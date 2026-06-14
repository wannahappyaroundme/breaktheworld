export interface Effect {
  /** advance; return false when finished (will be removed) */
  update(dtSec: number): boolean
  draw(ctx: CanvasRenderingContext2D): void
  /** lower draws first; default 0 */
  z?: number
}
