/** O11 project metadata. Opt-in basic AI intentions now drive physical players; there is still no playable match. */
export const PROJECT_NAME = 'O11 Football Manager' as const
export const PROJECT_PHASE = '5' as const
export const ENGINE_STATUS = 'basic-autonomous-decisions' as const

export const FOUNDATION_STAGES = [
  { id: '0A', title: 'Project foundation', summary: 'App, TypeScript, tests and deployment' },
  { id: '0B', title: 'Football data models', summary: 'Typed players, teams and match contracts' },
  { id: '0C', title: 'Deterministic core', summary: 'Clock, seeded randomness and verification' },
  { id: '0D', title: 'Engine state and commands', summary: 'Initialization, command scheduling and checkpoints' },
  { id: '0E', title: 'Release verification', summary: 'Replay testing and iPhone validation' },
  { id: '1', title: 'Player movement physics', summary: 'Fixed-step acceleration, turning, braking and pitch boundaries' },
  { id: '2', title: 'Ball movement physics', summary: 'Gravity, rolling friction, bounces and boundary detection' },
  { id: '3', title: 'Player-ball interactions', summary: 'Real reach, first-touch control, kicking and replay safety' },
  { id: '4', title: 'Automatic ball contact', summary: 'Swept intersections, physical interceptions and opponent contests' },
  { id: '5', title: 'Basic autonomous decisions', summary: 'Pursuit, pressing, formation support and physical pass attempts' },
] as const
