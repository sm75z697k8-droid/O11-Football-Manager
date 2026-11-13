import { makeExhibitionMatchSetup } from '../../data/fixtures/keeper-comparison'
import type { ExhibitionPreset } from '../../data/fixtures/keeper-comparison'
import { openingKickoffPass } from '../match/kickoff'
import { createFoundationMatch } from '../match/engine'
import type { FoundationMatchEngine } from '../match/engine'
import type { MatchSetup } from '../model/match'
import type { MatchState } from '../match/state'

/**
 * A thin controller over ONE authoritative headless engine.
 * No decorative movement, fabricated results, or secondary match state.
 */
export class MatchViewerSession {
  readonly setup: MatchSetup
  readonly preset: ExhibitionPreset
  private engine: FoundationMatchEngine
  private prior: MatchState
  private latest: MatchState

  /** Explicit seed enables exact replay; omitted seed retains the test fixture. */
  constructor(seed?: number, preset: ExhibitionPreset = 'balanced') {
    const template = makeExhibitionMatchSetup(preset)
    this.preset = preset
    const fixture = {
      ...template,
      seed: seed ?? template.seed,
      kickoff: { teamId: template.clubs[0].id },
    }
    this.engine = createFoundationMatch(fixture)
    this.setup = this.engine.getSetup()
    this.latest = this.engine.getState()
    this.prior = this.latest

    // The diagnostic fixture is driven by BOTH existing autonomous teams.
    // These commands are queued for tick one, not faked in the renderer.
    for (const club of this.setup.clubs) {
      const receipt = this.engine.submitCommand({
        commandId: 'viewer-start-ai-' + club.id,
        teamId: club.id, type: 'setAutonomousTeam', enabled: true,
      })
      if (!receipt.accepted) throw new Error('Could not enable team simulation: ' + receipt.reason)
    }
    // The opening pass is a genuine next-tick attemptKick at the centre
    // spot. AI remains frozen until the ball actually moves.
    const opening = this.engine.submitCommand(
      openingKickoffPass(this.engine.getState()),
    )
    if (!opening.accepted) {
      throw new Error('Failed to schedule physical opening kick-off: ' + opening.reason)
    }
    this.latest = this.engine.getState()
    this.prior = this.latest
  }

  get state(): MatchState { return this.latest }
  get previous(): MatchState { return this.prior }

  advance(steps: number): MatchState {
    if (!Number.isSafeInteger(steps) || steps < 0 || steps > 8) {
      throw new RangeError('Viewer can advance at most eight physical ticks per frame')
    }
    if (steps > 0) {
      // Keep adjacent *real* 50ms snapshots for smooth interpolation, even
      // when Safari needs to catch up multiple physics ticks in one frame.
      // advance() already supplies a detached authoritative snapshot.
      // Reuse it as the interpolation prior instead of deep-cloning the
      // ever-growing physical event logs a second time every Safari frame.
      this.prior = steps > 1
        ? this.engine.advance(steps - 1) : this.latest
      this.latest = this.engine.advance(1)
    }
    return this.latest
  }

  /** Referee's halftime is a real pause; never interpolate the break
   * as if players instantaneously travelled across a live pitch.
   */
  startSecondHalf(): MatchState {
    this.latest = this.engine.beginSecondHalf()
    this.prior = this.latest
    return this.latest
  }

  /** Provides an exact unmodified engine checkpoint for repeatability tests. */
  checkpoint() { return this.engine.checkpoint() }
}
