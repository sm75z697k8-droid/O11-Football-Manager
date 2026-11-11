/** O11 project metadata. Individual physical movement exists; a football match is not yet playable. */
export const PROJECT_NAME = 'O11 Football Manager' as const
export const PROJECT_PHASE = '1' as const
export const ENGINE_STATUS = 'player-motion-only' as const

export const FOUNDATION_STAGES = [
  { id: '0A', title: 'Project foundation', summary: 'App, TypeScript, tests and deployment' },
  { id: '0B', title: 'Football data models', summary: 'Typed players, teams and match contracts' },
  { id: '0C', title: 'Deterministic core', summary: 'Clock, seeded randomness and verification' },
  { id: '0D', title: 'Engine state and commands', summary: 'Initialization, command scheduling and checkpoints' },
  { id: '0E', title: 'Release verification', summary: 'Replay testing and iPhone validation' },
  { id: '1', title: 'Player movement physics', summary: 'Fixed-step acceleration, turning, braking and pitch boundaries' },
] as const
