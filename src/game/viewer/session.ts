import { makeFictionalMatchSetup } from '../../data/fixtures/fictional-match'
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
  private engine: FoundationMatchEngine
  private prior: MatchState
  private latest: MatchState

  constructor() {
    this.engine = createFoundationMatch(makeFictionalMatchSetup())
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
      if (steps > 1) this.engine.advance(steps - 1)
      this.prior = steps > 1 ? this.engine.getState() : this.latest
      this.latest = this.engine.advance(1)
    }
    return this.latest
  }

  /** Provides an exact unmodified engine checkpoint for repeatability tests. */
  checkpoint() { return this.engine.checkpoint() }
}
