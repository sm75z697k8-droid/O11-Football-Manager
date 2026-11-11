/** Metric geometry; never screen pixels. X runs along the length of the pitch. */
export interface Point2 {
  readonly xM: number
  readonly yM: number
}

export interface Point3 extends Point2 {
  readonly zM: number
}

export interface PitchDefinition {
  readonly lengthM: number
  readonly widthM: number
  readonly goalWidthM: number
  readonly goalHeightM: number
  readonly penaltyAreaDepthM: number
  readonly penaltyAreaWidthM: number
  readonly goalAreaDepthM: number
  readonly goalAreaWidthM: number
  readonly penaltySpotDistanceM: number
  readonly centreCircleRadiusM: number
}

/** 105m × 68m is the starting baseline, not a renderer constraint. */
export const DEFAULT_PITCH: Readonly<PitchDefinition> = Object.freeze({
  lengthM: 105,
  widthM: 68,
  goalWidthM: 7.32,
  goalHeightM: 2.44,
  penaltyAreaDepthM: 16.5,
  penaltyAreaWidthM: 40.32,
  goalAreaDepthM: 5.5,
  goalAreaWidthM: 18.32,
  penaltySpotDistanceM: 11,
  centreCircleRadiusM: 9.15,
})
