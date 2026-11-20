import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { selectPreviewSquadMembers } from '../data/preview-squad-members'
import { MAN_UTD_RASHFORD_UPDATE, INITIAL_LOCAL_SQUAD } from '../data/initial-local-squad'
import { ensureInitialSquadSaved, isConsistentStoredSquad, readStoredSquad } from '../storage/local-squad'
import type { StoredLocalSquad } from '../storage/local-squad'
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
  const [loadedSquad, setLoadedSquad] = useState<StoredLocalSquad | null>(null)
  const [storageStatus, setStorageStatus] =
    useState<'loading' | 'loaded' | 'review' | 'demo'>('loading')

  useEffect(() => {
    let active = true
    const loadSquad = async () => {
      try {
        // Returns the actual IndexedDB record AFTER first-write or a safe
        // one-time Bruno/Šeško migration commits. Never render the defaults
        // instead of a successfully loaded local record.
        const result = await ensureInitialSquadSaved(
          INITIAL_LOCAL_SQUAD, undefined, MAN_UTD_RASHFORD_UPDATE,
        )
        if (!isConsistentStoredSquad(result.squad)) {
          throw new Error('Stored first-team data is inconsistent')
        }
        if (active) {
          setLoadedSquad(result.squad)
          setStorageStatus('loaded')
        }
      } catch {
        // A guarded migration may refuse an edited legacy shirt/player.
        // Try READ-ONLY access to that save, rather than concealing it behind
        // bundled players or overwriting it with a fresh test squad.
        try {
          const saved = await readStoredSquad(INITIAL_LOCAL_SQUAD.clubId)
          if (!active) return
          if (saved) {
            setLoadedSquad(saved)
            setStorageStatus('review')
          } else {
            setStorageStatus('demo')
          }
        } catch {
          if (active) setStorageStatus('demo')
        }
      }
    }
    void loadSquad()
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
  // No saved player data is shown until loading has completed. If IndexedDB
  // cannot be read, the GitHub seed is shown explicitly as a demo fallback.
  const displayedSquad = loadedSquad ?? (storageStatus === 'demo' ? INITIAL_LOCAL_SQUAD : null)
  const members = displayedSquad ? selectPreviewSquadMembers(displayedSquad) : []
  const selectedMember = members.find(item => item.player.id === selectedId)
  const club = displayedSquad?.club ?? INITIAL_LOCAL_SQUAD.club
  const formation = displayedSquad?.lineupPreview.formation ??
    INITIAL_LOCAL_SQUAD.lineupPreview.formation

  return (
    <div className="first-team-preview" ref={rootRef}>
      <StadiumOnly canvasLabel="Football stadium and first-team lineup preview" />
      <header className="first-team-identity">
        <span className="first-team-crest" aria-hidden="true">MU</span>
        <span className="first-team-identity-copy">
          <strong>{club.name}</strong>
          <span>First team · Left-half lineup preview</span>
          <span className={'first-team-local-save' +
            (storageStatus === 'loaded' ? '' : ' first-team-local-save--warning')}
            role="status" aria-live="polite">
            {storageStatus === 'loaded' ? 'Saved squad loaded from this iPhone'
              : storageStatus === 'loading' ? 'Loading saved squad…'
                : storageStatus === 'review' ? 'Local save loaded · update needs review'
                  : 'Demo preview · local save unavailable'}
          </span>
        </span>
        <span className="first-team-formation">{formation}</span>
      </header>

      {projection.scale > 0 && members.map(({ player, assignment: starter }) => {
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

      <div className="first-team-hint">
        {storageStatus === 'loading' ? 'Loading saved lineup…'
          : formation + ' · Gold pointer = preview facing · Tap player'}
      </div>
      {selectedMember && (
        <PlayerStatsPanel key={selectedMember.player.id} player={selectedMember.player}
          assignment={selectedMember.assignment} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
