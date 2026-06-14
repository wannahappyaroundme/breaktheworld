import type { Target } from '../targets/target'
import type { Particles } from '../engine/particles'
import type { Effects } from '../effects/manager'
import type { Camera } from '../engine/camera'
import type { Audio } from '../engine/audio'

export interface World {
  target: Target
  particles: Particles
  effects: Effects
  camera: Camera
  audio: Audio
  w: number
  h: number
}

/**
 * 'point' weapons fire on every tap and along drags.
 * 'cinematic' weapons play a full-screen action and only fire on a fresh tap.
 */
export type WeaponMode = 'point' | 'cinematic'

export interface Weapon {
  id: string
  name: string
  icon: string
  mode: WeaponMode
  /** cinematic re-trigger guard (seconds); 0 for point weapons */
  cooldown?: number
  apply(world: World, x: number, y: number): void
}
