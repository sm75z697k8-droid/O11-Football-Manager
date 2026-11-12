/** Fixed-step accumulator for real-time playback. Engine physics stays at 50 ms.
 * Rendering speed changes wall-clock pacing, not simulation timestep or physics.
 */
export const STEP_MS = 50
export const MAX_FRAME_MS = 250
export const MAX_TICKS_PER_FRAME = 8
export type PlaybackSpeed = 1 | 2 | 4

export interface FrameAdvance {
  readonly steps: number
  readonly remainderMs: number
  readonly limited: boolean
}

export function calculateFrameAdvance(
  remainderMs: number, frameElapsedMs: number, speed: PlaybackSpeed,
): FrameAdvance {
  const elapsed = Number.isFinite(frameElapsedMs)
    ? Math.max(0, Math.min(frameElapsedMs, MAX_FRAME_MS)) : 0
  const debt = Math.max(0, Number.isFinite(remainderMs) ? remainderMs : 0)
  const accumulated = debt + elapsed * speed
  const requested = Math.floor(accumulated / STEP_MS)
  const steps = Math.min(MAX_TICKS_PER_FRAME, requested)
  const limited = requested > MAX_TICKS_PER_FRAME
  return { steps, remainderMs: limited ? 0 : accumulated - steps * STEP_MS, limited }
}

export function formatDiagnosticTime(tick: number): string {
  const seconds = Math.floor(tick * STEP_MS / 1000)
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
    String(seconds % 60).padStart(2, '0')
}
