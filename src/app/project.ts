/** O11 project metadata. Player motion, ball physics and explicit player-ball contact exist; no playable match yet. */
export const PROJECT_NAME = 'O11 Football Manager' as const
export const PROJECT_PHASE = '3' as const
export const ENGINE_STATUS = 'player-ball-contact' as const

export const FOUNDATION_STAGES = [
  { id: '0A', title: 'Project foundation', summary: 'App, TypeScript, tests and deployment' },
  { id: '0B', title: 'Football data models', summary: 'Typed players, teams and match contracts' },
  { id: '0C', title: 'Deterministic core', summary: 'Clock, seeded randomness and verification' },
  { id: '0D', title: 'Engine state and commands', summary: 'Initialization, command scheduling and checkpoints' },
  { id: '0E', title: 'Release verification', summary: 'Replay testing and iPhone validation' },
  { id: '1', title: 'Player movement physics', summary: 'Fixed-step acceleration, turning, braking and pitch boundaries' },
  { id: '2', title: 'Ball movement physics', summary: 'Gravity, rolling friction, bounces and boundary detection' },
  { id: '3', title: 'Player-ball interactions', summary: 'Real reach, first-touch control, kicking and replay safety' },
] as const
