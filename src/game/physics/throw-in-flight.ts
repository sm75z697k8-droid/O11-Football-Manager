import type { Point2 } from '../model/pitch'
import { BALL_RADIUS_M } from './ball'

/**
 * A deliberately simplified two-handed overhead throw. The player is a 2D
 * point, so arm/foot animation is not modelled. Real match ball flight uses
 * the same height and velocity computation as tactical reception previews.
 * Values are estimated simulation calibration, not measured probabilities.
 */
export const THROW_IN_FLIGHT_VERSION = 'overhead-targeted-throw-thr-f1-v1'
export const THROW_IN_LAUNCH_HEIGHT_M = 1.85

export function throwInFlightVelocity(
  from: Point2, target: Point2, power: number,
  strength: number, angleError = 0,
): { readonly xMps: number; readonly yMps: number; readonly zMps: number } {
  const dx = target.xM - from.xM
  const dy = target.yM - from.yM
  const distance = Math.hypot(dx, dy)
  const verticalSpeed = 2.9 + power * 2.2
  const airtime = (verticalSpeed + Math.sqrt(verticalSpeed * verticalSpeed +
    2 * 9.81 * (THROW_IN_LAUNCH_HEIGHT_M - BALL_RADIUS_M))) / 9.81
  const idealPlanar = (Math.exp(.008 * distance) - 1) /
    (.008 * airtime)
  const planarSpeed = Math.min(25, idealPlanar *
    (.80 + .34 * power) * (.97 + strength * .0006))
  const bearing = Math.atan2(dy, dx) + angleError
  return {
    xMps: Math.cos(bearing) * planarSpeed,
    yMps: Math.sin(bearing) * planarSpeed,
    zMps: verticalSpeed,
  }
}
