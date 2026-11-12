import type { Point2, PitchDefinition } from '../model/pitch'
import type { MatchState } from '../match/state'

/** Pure world-to-canvas coordinates in CSS pixels, independent of screen DPR. */
export interface PitchProjection {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale: number
}

export function projectPitch(
  viewportWidth: number, viewportHeight: number, pitch: PitchDefinition,
  margin = 18,
): PitchProjection {
  const width = Math.max(0, viewportWidth - 2 * margin)
  const height = Math.max(0, viewportHeight - 2 * margin)
  const scale = Math.max(0, Math.min(width / pitch.lengthM, height / pitch.widthM))
  const projectedWidth = pitch.lengthM * scale
  const projectedHeight = pitch.widthM * scale
  return {
    x: (viewportWidth - projectedWidth) / 2,
    y: (viewportHeight - projectedHeight) / 2,
    width: projectedWidth,
    height: projectedHeight,
    scale,
  }
}

export function projectPoint(position: Point2, projection: PitchProjection): { x: number; y: number } {
  return {
    x: projection.x + position.xM * projection.scale,
    y: projection.y + position.yM * projection.scale,
  }
}

export function interpolatePosition(
  from: Point2, to: Point2, alpha: number,
): Point2 {
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1))
  return { xM: from.xM + (to.xM - from.xM) * a,
    yM: from.yM + (to.yM - from.yM) * a }
}

/** Hit-testing uses the same projection and canonical state as rendering. */
export function findPlayerAt(
  point: { x: number; y: number }, state: MatchState,
  projection: PitchProjection, minimumRadius = 16,
): string | null {
  const radius = Math.max(minimumRadius, projection.scale * 1.5)
  let nearest: { id: string; dist: number } | null = null
  for (const player of state.players) {
    const projected = projectPoint(player.position, projection)
    const dist = Math.hypot(projected.x - point.x, projected.y - point.y)
    if (dist <= radius && (nearest === null || dist < nearest.dist)) {
      nearest = { id: player.playerId, dist }
    }
  }
  return nearest?.id ?? null
}
