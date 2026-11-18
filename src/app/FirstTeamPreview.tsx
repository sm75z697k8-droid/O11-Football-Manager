import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FIRST_TEAM } from '../data/first-team'
import { DEFAULT_PITCH } from '../game/model/pitch'
import { projectPitch, projectPoint } from '../game/viewer/geometry'
import type { Formation433Slot } from '../game/model/team'
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
  const selectedAssignment = FIRST_TEAM.sheet.starters.find(item => item.playerId === selectedId)

  return (
    <div className="first-team-preview" ref={rootRef}>
      <StadiumOnly canvasLabel="Football stadium and pitch beneath a fictional starting eleven" />
      <header className="first-team-identity">
        <span className="first-team-crest" aria-hidden="true">H</span>
        <span className="first-team-identity-copy">
          <strong>{FIRST_TEAM.club.name}</strong>
          <span>Fictional first team · Lineup preview</span>
        </span>
        <span className="first-team-formation">{FIRST_TEAM.sheet.formation}</span>
      </header>

      {projection.scale > 0 && FIRST_TEAM.sheet.starters.map(starter => {
        const player = FIRST_TEAM.players.find(item => item.id === starter.playerId)
        if (!player) return null
        const point = projectPoint(FIRST_TEAM.positions[starter.slot as Formation433Slot], projection)
        const positionStyle: CSSProperties = { left: point.x, top: point.y }
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
              ', ' + starter.slot + '. Show player attributes'}
          >
            <span className="first-team-marker-disc">{starter.shirtNumber}</span>
            <span className="first-team-marker-name">{surname}</span>
          </button>
        )
      })}

      <div className="first-team-hint">Tap a player to inspect</div>
      {selectedPlayer && selectedAssignment && (
        <PlayerStatsPanel key={selectedPlayer.id} player={selectedPlayer}
          assignment={selectedAssignment} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
