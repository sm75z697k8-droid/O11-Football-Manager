import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { MatchState } from '../game/match/state'
import { MatchViewerSession } from '../game/viewer/session'
import { findPlayerAt, projectPitch } from '../game/viewer/geometry'
import { renderMatchFrame } from '../game/viewer/renderer'
import { calculateFrameAdvance, formatDiagnosticTime } from '../game/viewer/pacing'
import type { PlaybackSpeed } from '../game/viewer/pacing'
import './App.css'

type OverlayPanel = 'none' | 'players' | 'events'
type FeedItem = {
  readonly key: string
  readonly tick: number
  readonly kind: 'challenge' | 'contact' | 'kick' | 'goal'
  readonly title: string
  readonly detail: string
}

function physicalEvents(state: MatchState): FeedItem[] {
  const automatic = state.automaticContactEvents.map((event, index) => ({
    key: 'auto-' + index,
    tick: event.tick,
    kind: 'challenge' as const,
    title: event.outcome.replace(/([A-Z])/g, ' $1').toUpperCase(),
    detail: event.playerId.replaceAll('_', ' ') + ' · ' + event.kind,
  }))
  const manual = state.contactEvents
    .filter(event => !['outOfReach', 'occupied', 'invalidDirection'].includes(event.outcome))
    .map((event, index) => ({
      key: 'manual-' + index,
      tick: event.tick,
      kind: event.kind === 'kick' ? 'kick' as const : 'contact' as const,
      title: event.outcome.toUpperCase(),
      detail: event.playerId.replaceAll('_', ' ') + ' · ' + event.kind,
    }))
  const goals = state.goalEvents.map((goal, index) => ({
    key: 'goal-' + index,
    tick: goal.tick,
    kind: 'goal' as const,
    title: goal.ownGoal ? 'OWN GOAL' : 'GOAL',
    detail: goal.scoringTeamId.replaceAll('_', ' ') +
      ' · last touch ' + goal.lastTouchPlayerId.replaceAll('_', ' '),
  }))
  return [...automatic, ...manual, ...goals].sort((a, b) =>
    b.tick - a.tick || a.key.localeCompare(b.key)).slice(0, 14)
}

export default function App() {
  const sessionRef = useRef<MatchViewerSession | null>(null)
  if (sessionRef.current === null) sessionRef.current = new MatchViewerSession()
  const session = sessionRef.current
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<OverlayPanel>('none')
  const [hud, setHud] = useState<MatchState>(session.state)
  const [renderRevision, setRenderRevision] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const active = sessionRef.current
    if (!canvas || !active) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      setFailure('Canvas 2D is unavailable on this browser.')
      setPlaying(false)
      return
    }

    let frame = 0
    let previousTime: number | null = null
    let hudTime = 0
    let remainder = 0
    let width = 0
    let height = 0
    let disposed = false

    const draw = (alpha: number) => {
      if (!ctx || width <= 0 || height <= 0) return
      renderMatchFrame(ctx, {
        latest: active.state,
        previous: active.previous,
        setup: active.setup,
        width, height, alpha,
        selectedPlayerId: selectedId,
      })
    }

    const resize = () => {
      if (!ctx) return
      const bounds = canvas.getBoundingClientRect()
      width = Math.max(0, bounds.width)
      height = Math.max(0, bounds.height)
      if (!width || !height) return
      // iPhone Retina cap avoids allocating an unnecessarily huge frame buffer.
      const ratio = Math.min(window.devicePixelRatio || 1, 2,
        2048 / width, 1400 / height)
      const pixelsWide = Math.max(1, Math.round(width * ratio))
      const pixelsHigh = Math.max(1, Math.round(height * ratio))
      if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
        canvas.width = pixelsWide
        canvas.height = pixelsHigh
      }
      ctx.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0)
      draw(1)
    }

    const loop = (now: number) => {
      if (disposed) return
      if (previousTime === null) previousTime = now
      const delta = now - previousTime
      previousTime = now
      const update = calculateFrameAdvance(remainder, delta, speed)
      remainder = update.remainderMs
      try {
        if (update.steps > 0) active.advance(update.steps)
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'Simulation stopped unexpectedly.')
        setPlaying(false)
        return
      }
      draw(Math.max(0, Math.min(1, remainder / 50)))
      if (now - hudTime >= 135) {
        setHud(active.state)
        hudTime = now
      }
      // Out-of-play is not a goal, throw-in or other restart yet. Stop the
      // viewer deliberately to avoid burning CPU on an unplayable dead end.
      if (active.state.ball.outsidePitch) {
        setHud(active.state)
        setPlaying(false)
        draw(1)
        return
      }
      frame = window.requestAnimationFrame(loop)
    }

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resize) : null
    observer?.observe(canvas)
    window.addEventListener('resize', resize)
    resize()
    if (playing && !active.state.ball.outsidePitch) {
      frame = window.requestAnimationFrame(loop)
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [playing, speed, selectedId, renderRevision])

  const reset = () => {
    const fresh = new MatchViewerSession()
    sessionRef.current = fresh
    setPlaying(false)
    setFailure(null)
    setSelectedId(null)
    setPanel('none')
    setHud(fresh.state)
    setRenderRevision(revision => revision + 1)
  }

  const stepOne = () => {
    if (playing || failure || hud.ball.outsidePitch) return
    try {
      const next = sessionRef.current?.advance(1)
      if (next) setHud(next)
      setRenderRevision(revision => revision + 1)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not advance simulation.')
    }
  }

  const selectOnPitch = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const active = sessionRef.current
    if (!canvas || !active) return
    const rect = canvas.getBoundingClientRect()
    setSelectedId(findPlayerAt({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }, active.state, projectPitch(rect.width, rect.height, active.setup.pitch)))
    setPanel('none')
  }

  const selected = hud.players.find(player => player.playerId === selectedId)
  const selectedDefinition = session.setup.players.find(player => player.id === selectedId)
  const decision = hud.ai.decisionSnapshot.find(item => item.playerId === selectedId)
  const owner = hud.players.find(player => player.playerId === hud.ball.controllerId)
  const ownerClub = session.setup.clubs.find(club => club.id === owner?.clubId)
  const events = physicalEvents(hud)
  const goal = hud.goalEvents.at(-1)
  const scoringClub = session.setup.clubs.find(c => c.id === goal?.scoringTeamId)
  const goalScorer = hud.players.find(p => p.playerId === goal?.lastTouchPlayerId)
  const out = hud.ball.outsidePitch
  const activeTeam = hud.ai.enabledTeams.filter(Boolean).length
  const successContacts = hud.contactEvents.filter(e =>
    ['controlled', 'miscontrolled', 'kicked'].includes(e.outcome)).length
  const statuses = failure ? 'ENGINE ERROR' :
    goal ? 'GOAL · ' + (scoringClub?.shortName ?? 'MATCH') :
    out ? 'OUT OF PLAY' :
    hud.kickoff?.phase === 'awaitingKick' ? 'KICK-OFF · HARBOR' :
    playing ? 'LIVE SIMULATION' : 'PAUSED'

  return (
    <main className="immersive-match">
      <canvas
        className="full-pitch"
        ref={canvasRef}
        onClick={selectOnPitch}
        aria-label="Interactive top-down 2D football pitch displaying the authoritative player and ball positions. Tap a player marker to inspect it."
      />

      <div className="stadium-fade stadium-fade-top" aria-hidden="true" />
      <div className="stadium-fade stadium-fade-bottom" aria-hidden="true" />

      <header className="match-overlay-header">
        <div className="o11-mini-brand">
          <span className="o11-mini-badge">O11</span>
          <span className="o11-brand-sub">MATCH LAB</span>
        </div>

        <div className="match-scoreboard" aria-label="Fictional demonstration scores awarded by physical goal-line crossings">
          <div className="team-side home-side">
            <span className="team-crest home-crest">H</span>
            <span className="team-names"><strong>HAR</strong><small>HARBOR ATHLETIC</small></span>
          </div>
          <div className="match-centre">
            <strong>{hud.teams[0].score} <span>:</span> {hud.teams[1].score}</strong>
            <small>EXHIBITION · NO RESTARTS</small>
          </div>
          <div className="team-side away-side">
            <span className="team-names"><strong>VAL</strong><small>VALE ROVERS</small></span>
            <span className="team-crest away-crest">V</span>
          </div>
        </div>

        <div className="right-nav">
          <span className="sim-clock" aria-label="Elapsed diagnostic simulation time">
            {formatDiagnosticTime(hud.clock.tick)}
          </span>
          <button
            type="button"
            className={panel === 'players' ? 'hud-icon selected' : 'hud-icon'}
            aria-label="Open player information"
            aria-pressed={panel === 'players'}
            onClick={() => setPanel(current => current === 'players' ? 'none' : 'players')}
          >◉</button>
          <button
            type="button"
            className={panel === 'events' ? 'hud-icon selected' : 'hud-icon'}
            aria-label="Open physical events"
            aria-pressed={panel === 'events'}
            onClick={() => setPanel(current => current === 'events' ? 'none' : 'events')}
          >☷</button>
        </div>
      </header>

      <div className="match-caption-top" aria-live="polite">
        <span className={playing ? 'match-led lit' : 'match-led'} />
        {statuses}
        <span className="caption-divider">/</span>
        PHYSICS ENGINE
      </div>

      <div className="match-corner-left">
        <span>11 VS 11</span>
        <span>CANVAS 2D</span>
      </div>

      {selected && selectedDefinition && panel === 'none' && (
        <aside className="quick-player" aria-label="Selected player details">
          <span className={selected.clubId === session.setup.clubs[0].id ?
            'quick-shirt shirt-home' : 'quick-shirt shirt-away'}>{selected.shirtNumber}</span>
          <div className="quick-player-copy">
            <strong>{selectedDefinition.profile.fullName}</strong>
            <small>{selected.formationSlot} <span>·</span> {decision?.action.toUpperCase() ?? 'IDLE'} <span>·</span> {Math.hypot(selected.velocity.xMps, selected.velocity.yMps).toFixed(1)} M/S</small>
          </div>
          <button type="button" onClick={() => setSelectedId(null)} aria-label="Close player details">×</button>
        </aside>
      )}

      {panel !== 'none' && (
        <aside className="overlay-drawer" aria-label={panel === 'players' ? 'Player inspector' : 'Physical event log'}>
          <div className="drawer-head">
            <div><small>O11 MATCH LAB / TELEMETRY</small><strong>{panel === 'players' ? 'Player inspector' : 'Physical events'}</strong></div>
            <button type="button" onClick={() => setPanel('none')} aria-label="Close panel">×</button>
          </div>

          {panel === 'players' ? (
            <div className="drawer-content">
              <label htmlFor="inspect-player">SELECT PLAYER</label>
              <select id="inspect-player" value={selectedId ?? ''}
                onChange={event => setSelectedId(event.target.value || null)}>
                <option value="">Choose a footballer</option>
                {session.setup.clubs.map(club => (
                  <optgroup label={club.name} key={club.id}>
                    {hud.players.filter(p => p.clubId === club.id).map(p => (
                      <option value={p.playerId} key={p.playerId}>
                        {p.shirtNumber} · {p.formationSlot}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {selected && selectedDefinition ? (
                <div className="drawer-player">
                  <strong>{selectedDefinition.profile.fullName}</strong>
                  <span>{selected.formationSlot} · {selected.role}</span>
                  <div className="drawer-metrics">
                    <div><small>ACTION</small><b>{decision?.action.toUpperCase() ?? 'IDLE'}</b></div>
                    <div><small>RUNNING SPEED</small><b>{Math.hypot(selected.velocity.xMps, selected.velocity.yMps).toFixed(1)} m/s</b></div>
                  </div>
                </div>
              ) : <p className="drawer-muted">Tap a player on the pitch or choose one above.</p>}
              <div className="drawer-divider" />
              <div className="drawer-stat"><span>ACTIVE AI TEAMS</span><strong>{activeTeam} / 2</strong></div>
              <div className="drawer-stat"><span>PHYSICAL CONTACTS</span><strong>{hud.automaticContactEvents.length + successContacts}</strong></div>
              <div className="drawer-stat"><span>BALL CONTROLLER</span><strong>{owner ? ownerClub?.shortName + ' #' + owner.shirtNumber : 'NONE'}</strong></div>
              <p className="drawer-legal">Goals are recorded only when the physical ball crosses the goalmouth. This is an exhibition without a full match clock, referee or restarts.</p>
            </div>
          ) : (
            <div className="drawer-content event-feed">
              {events.length ? events.map(event => (
                <div className="drawer-event" key={event.key}>
                  <span className="event-symbol">{event.kind === 'goal' ? '★' : event.kind === 'kick' ? '↗' : '●'}</span>
                  <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                  <time>{formatDiagnosticTime(event.tick)}</time>
                </div>
              )) : <p className="drawer-muted">No physical contact has happened yet. Press Play to watch the simulation.</p>}
            </div>
          )}
        </aside>
      )}

      {(out || failure) && (
        <section className="stoppage-overlay" role="status" aria-live="polite">
          <span className="stoppage-kicker">{failure ? 'SIMULATION ERROR' : goal ? 'PHYSICAL GOAL CONFIRMED' : 'BALL OUT OF PLAY'}</span>
          <strong>{failure ? 'The engine stopped' : goal ? 'GOAL · ' + (scoringClub?.name ?? 'Team') : 'Awaiting football restarts'}</strong>
          <p>{failure ?? (goal
            ? (goal.ownGoal ? 'Own goal' : 'Last touch') +
              (goalScorer ? ' · #' + goalScorer.shirtNumber : '') +
              ' · The full ball crossed between the posts and under the bar. Restart rules are not implemented yet.'
            : 'The ball left the playing field. Throw-ins, corners and goal kicks are not implemented yet.')}</p>
          <button type="button" onClick={reset}>↺ Reset simulation</button>
        </section>
      )}

      <footer className="floating-transport">
        <div className="transport-identity">
          <span className="transport-title">O11 <span>/</span> SIM</span>
          <span className="transport-subtitle">EARLY ENGINE PREVIEW</span>
        </div>
        <div className="transport-controls" aria-label="Simulation playback">
          <button type="button" className={playing ? 'transport-primary playing' : 'transport-primary'}
            onClick={() => setPlaying(value => !value)}
            disabled={Boolean(failure) || out}
            aria-label={playing ? 'Pause simulation' : 'Start simulation'}>
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><strong>{playing ? 'PAUSE' : 'PLAY'}</strong>
          </button>
          <button type="button" className="transport-secondary"
            onClick={stepOne} disabled={playing || Boolean(failure) || out}
            aria-label="Advance one simulation step">STEP</button>
          <div className="transport-divider" aria-hidden="true" />
          <div className="transport-speeds" aria-label="Simulation speed">
            {([1, 2, 4] as const).map(value => (
              <button type="button" key={value}
                aria-pressed={speed === value}
                onClick={() => setSpeed(value)}
                className={speed === value ? 'speed-on' : ''}>{value}×</button>
            ))}
          </div>
          <div className="transport-divider" aria-hidden="true" />
          <button type="button" className="transport-reset"
            onClick={reset} aria-label="Restart simulation from the beginning">↺</button>
        </div>
        <div className="transport-tail">
          <span>{goal ? 'PHYSICAL GOAL' : hud.ball.outsidePitch ? 'OUT OF PLAY' : '20 HZ PHYSICS'}</span>
          <small>REAL SHOTS / NO RESTARTS YET</small>
        </div>
      </footer>

      <div className="orientation-overlay" aria-label="Rotate the phone to landscape">
        <div className="orientation-phone" aria-hidden="true"><span /></div>
        <strong>Rotate to landscape</strong>
        <p>O11 uses a full-screen tactical pitch, designed for landscape viewing.</p>
        <small>O11 / MATCH LAB</small>
      </div>
    </main>
  )
}
