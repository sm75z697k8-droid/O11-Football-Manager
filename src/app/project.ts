/** O11 project metadata. Real-time landscape Canvas now visualizes the authoritative headless engine; no official match rules or results yet. */
export const PROJECT_NAME = 'O11 Football Manager' as const
export const PROJECT_PHASE = '6.9A' as const
export const ENGINE_STATUS = 'short-horizon-on-ball-intelligence' as const

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
  { id: '6', title: 'Real 2D match viewer', summary: 'Landscape Canvas, real player physics, controls and telemetry' },
  { id: '6.3', title: 'Team coordination', summary: 'Predictive reception, dynamic support and layered defensive roles' },
  { id: '6.3.1', title: 'Flank discipline and passing', summary: 'Team-relative width, explicit receiver, physical meeting and speed calibration' },
  { id: '6.4', title: 'Intelligent possession and dynamic support', summary: 'Open passing corridors, pressure-aware releases and safe spatial outlets' },
  { id: '6.5', title: 'Team-wide defensive intelligence', summary: 'Compact recovery, zonal threats, pressing and goal-side cover for both teams' },
  { id: '6.6', title: 'Reactive ball recovery', summary: 'Contested loose balls, instant turnover responses and faster link play' },
  { id: '6.7', title: 'Goal-directed attacking', summary: 'Chance creation, physical shots, keeper saves and real goalmouth adjudication' },
  { id: '6.8', title: 'Seeded match variation', summary: 'New unique match seeds, exact replay and bounded attribute-aware decision variety' },
  { id: '6.9A', title: 'Short-horizon attacking intelligence', summary: 'Predictive pass pressure, ball-carrying risk, shot corridors and explainable intent' },
] as const
