import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FIRST_TEAM } from '../data/first-team'
import { BRUNO_REPLACEMENT, INITIAL_LOCAL_SQUAD } from '../data/initial-local-squad'
import { ensureInitialSquadSaved } from '../storage/local-squad'
import {
  FIRST_TEAM_4231_ASSIGNMENTS, FIRST_TEAM_PREVIEW_FORMATION,
} from '../data/first-team-lineup'
import { DEFAULT_PITCH } from '../game/model/pitch'
import { facingAngleDegrees, projectPitch, projectPoint } from '../game/viewer/geometry'
import PlayerStatsPanel from './PlayerStatsPanel'
import StadiumOnly from './StadiumOnly'
import './FirstTeamPreview.css'

/**
 * One club's senior lineup, positioned from the same metric projection as
 * the stadium markings. This is a squad preview only: no ball, clock, result,
 * match engine or opponent is created.
 */
export default function FirstTeamPreview() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localSave, setLocalSave] = useState<'saving' | 'saved' | 'unavailable'>('saving')

  useEffect(() => {
    let active = true
    // IndexedDB is optional: if Safari blocks it, the existing preview
    // remains playable and communicates the failure rather than lying.
    void ensureInitialSquadSaved(INITIAL_LOCAL_SQUAD, undefined, BRUNO_REPLACEMENT)
      .then(() => { if (active) setLocalSave('saved') })
      .catch(() => { if (active) setLocalSave('unavailable') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const rect = root.getBoundingClientRect()
      setSize(previous => {
        if (previous.width === rect.width && previous.height === rect.height) return previous
        return { width: rect.width, height: rect.height }
      })
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(root)
    window.addEventListener('resize', update)
    update()
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  const projection = projectPitch(size.width, size.height, DEFAULT_PITCH)
  const selectedPlayer = FIRST_TEAM.players.find(player => player.id === selectedId)
  const selectedAssignment = FIRST_TEAM_4231_ASSIGNMENTS.find(item => item.playerId === selectedId)

  return (
    <div className="first-team-preview" ref={rootRef}>
      <StadiumOnly canvasLabel="Football stadium and pitch beneath a fictional starting eleven" />
      <header className="first-team-identity">
        <span className="first-team-crest" aria-hidden="true">MU</span>
        <span className="first-team-identity-copy">
          <strong>{FIRST_TEAM.club.name}</strong>
          <span>Fictional players · Left-half preview</span>
          <span className="first-team-local-save" role="status" aria-live="polite">
            {localSave === 'saved' ? 'Stored on this iPhone'
              : localSave === 'saving' ? 'Saving team locally…' : 'Local storage unavailable'}
          </span>
        </span>
        <span className="first-team-formation">{FIRST_TEAM_PREVIEW_FORMATION}</span>
      </header>

      {projection.scale > 0 && FIRST_TEAM_4231_ASSIGNMENTS.map(starter => {
        const player = FIRST_TEAM.players.find(item => item.id === starter.playerId)
        if (!player) return null
        const point = projectPoint(starter.position, projection)
        const positionStyle: CSSProperties = { left: point.x, top: point.y }
        // Only a lineup-preview orientation: face the opposing goal.
        // Future live-match headings must be supplied by simulated player state.
        const facingAngle = facingAngleDegrees(starter.position, {
          xM: DEFAULT_PITCH.lengthM,
          yM: DEFAULT_PITCH.widthM / 2,
        })
        const directionStyle: CSSProperties = {
          transform: `rotate(${facingAngle}deg)`,
        }
        const surname = player.profile.fullName.split(' ').at(-1)
        return (
          <button
            type="button"
            key={player.id}
            className={'first-team-marker' + (selectedId === player.id ? ' first-team-marker--selected' : '')}
            style={positionStyle}
            onClick={() => setSelectedId(selectedId === player.id ? null : player.id)}
            aria-pressed={selectedId === player.id}
            aria-label={'Number ' + starter.shirtNumber + ', ' + player.profile.fullName +
              ', ' + starter.slot +
              '. Facing approximately towards the opposing goal. Show player attributes'}
          >
            <span className="first-team-marker-disc" aria-hidden="true">
              {starter.shirtNumber}
              <span className="first-team-marker-facing" style={directionStyle} />
            </span>
            <span className="first-team-marker-name">{surname}</span>
          </button>
        )
      })}

      <div className="first-team-hint">4-2-3-1 · Gold pointer = preview facing · Tap player</div>
      {selectedPlayer && selectedAssignment && (
        <PlayerStatsPanel key={selectedPlayer.id} player={selectedPlayer}
          assignment={selectedAssignment} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
