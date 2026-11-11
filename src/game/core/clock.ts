/**
 * O11 fixed-step simulation clock, v1.
 *
 * One tick represents exactly 50 milliseconds of SIMULATED time.
 * React render frames, Date.now(), and browser timers never determine tick count.
 *
 * Football periods and stoppage time belong to a later rules controller.
 */
export const CLOCK_SCHEMA_VERSION = 1 as const
export const FIXED_STEP_MILLISECONDS = 50 as const
export const MAX_SIMULATION_TICK = Math.floor(
  Number.MAX_SAFE_INTEGER / FIXED_STEP_MILLISECONDS,
)

export interface SimulationClock {
  readonly schemaVersion: typeof CLOCK_SCHEMA_VERSION
  readonly tick: number
}

function validTick(tick: unknown): tick is number {
  return typeof tick === 'number' &&
    Number.isSafeInteger(tick) &&
    tick >= 0 &&
    tick <= MAX_SIMULATION_TICK
}

function assertClock(value: unknown): asserts value is SimulationClock {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    !('schemaVersion' in value) || value.schemaVersion !== CLOCK_SCHEMA_VERSION ||
    !('tick' in value) || !validTick(value.tick)
  ) {
    throw new RangeError('Invalid or incompatible simulation clock checkpoint')
  }
}

/** Create a serializable, immutable clock. Tick zero is the initial state. */
export function createSimulationClock(tick = 0): SimulationClock {
  if (!validTick(tick)) {
    throw new RangeError('Tick must be a nonnegative safe integer within the simulation range')
  }
  return Object.freeze({ schemaVersion: CLOCK_SCHEMA_VERSION, tick })
}

/** No implicit wall-clock progression: callers explicitly request logical steps. */
export function advanceSimulationClock(
  clock: SimulationClock, steps = 1,
): SimulationClock {
  assertClock(clock)
  if (!Number.isSafeInteger(steps) || steps < 0 || steps > MAX_SIMULATION_TICK - clock.tick) {
    throw new RangeError('Invalid step count or simulation tick overflow')
  }
  return steps === 0 ? clock : createSimulationClock(clock.tick + steps)
}

/** Express simulated elapsed time exactly, in integer milliseconds. */
export function elapsedSimulationMilliseconds(clock: SimulationClock): number {
  assertClock(clock)
  return clock.tick * FIXED_STEP_MILLISECONDS
}

/** Restore from an untrusted JSON checkpoint with schema validation. */
export function restoreSimulationClock(checkpoint: unknown): SimulationClock {
  assertClock(checkpoint)
  return createSimulationClock(checkpoint.tick)
}
