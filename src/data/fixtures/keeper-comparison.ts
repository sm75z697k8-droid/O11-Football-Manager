import type { MatchSetup } from '../../game/model/match'
import { makeFictionalMatchSetup } from './fictional-match'

/**
 * Two deliberately fictional, intentionally contrasting goalkeeper profiles.
 * All outfield attributes, tactical instructions and match physics remain
 * untouched, so the balanced fixture is still available as a control.
 */
export type ExhibitionPreset = 'balanced' | 'keeper-comparison'

export const GOALKEEPER_COMPARISON_PROFILES = {
  club_harbor: {
    title: 'Reflex specialist',
    summary: 'Quicker reactions and longer dives; less reliable handling.',
    attributes: {
      reflexes: 94, diving: 90, handling: 45, positioning: 65,
      parrying: 63, crossClaiming: 59, oneOnOnes: 73,
    },
  },
  club_vale: {
    title: 'Secure handler',
    summary: 'Stronger catches, positioning and parries; slower to dive.',
    attributes: {
      reflexes: 55, diving: 59, handling: 92, positioning: 87,
      parrying: 93, crossClaiming: 85, oneOnOnes: 68,
    },
  },
} as const

/** A selectable variant, not a replacement for historical match baselines. */
export function makeExhibitionMatchSetup(
  preset: ExhibitionPreset = 'balanced',
): MatchSetup {
  const baseline = makeFictionalMatchSetup()
  if (preset === 'balanced') return baseline
  if (preset !== 'keeper-comparison') {
    throw new RangeError('Unknown match exhibition preset')
  }

  return {
    ...baseline,
    matchId: 'fixture_001_keeper_comparison',
    players: baseline.players.map(player => {
      if (!player.abilities.goalkeeping) return player
      const profile = player.clubId === baseline.clubs[0].id
        ? GOALKEEPER_COMPARISON_PROFILES.club_harbor
        : GOALKEEPER_COMPARISON_PROFILES.club_vale
      return {
        ...player,
        abilities: {
          ...player.abilities,
          goalkeeping: {
            ...player.abilities.goalkeeping,
            ...profile.attributes,
          },
        },
      }
    }),
  }
}
