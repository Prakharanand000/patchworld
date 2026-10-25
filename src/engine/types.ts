import type * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'

export interface MountedLevel {
  dispose: () => void
  stepBotAndRules: (frameIndex: number, elapsedSeconds: number) => StepResult
  /** Optional human-mode update; must not apply autonomous bot actions. */
  stepHumanAndRules?: (frameIndex: number, elapsedSeconds: number) => StepResult
  onPointerOrKey?: (event: { type: string; key?: string; ndc?: [number, number] }) => void
}

export interface StepResult {
  botState: string
  goalReached: boolean
  failedEarly?: string
}

export interface GeneratedLevelModule {
  buildWorld: (
    scene: THREE.Scene,
    world: RAPIER.World,
    namedBodies: Map<string, RAPIER.RigidBody>,
    eventQueue: RAPIER.EventQueue,
  ) => MountedLevel
}

export interface ContactSnapshot {
  bodyA: string
  bodyB: string
  totalForce: number
}
