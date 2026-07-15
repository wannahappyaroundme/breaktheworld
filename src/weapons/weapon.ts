import type { Target } from '../targets/target'
import type { Particles } from '../engine/particles'
import type { Effects } from '../effects/manager'
import type { Camera } from '../engine/camera'
import type { Audio } from '../engine/audio'
import type { DamageRequest, DamageResult } from '../combat/damage'

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

export interface WeaponAction {
  actionId: number
  targetRunId: number
  x: number
  y: number
  charge: number
  seed: number
  damage(request: Omit<DamageRequest, 'seed'>): DamageResult | null
}

export interface Weapon {
  id: string
  name: string
  icon: string
  mode: WeaponMode
  /** Temporary Task 3-5 bridge. Task 6 removes this member. */
  apply?: (world: World, x: number, y: number) => void
  quick?: (world: World, action: WeaponAction) => void
  drag?: (world: World, action: WeaponAction) => void
  charged?: (world: World, action: WeaponAction) => void
}
