import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { MatchState } from '../game/match/state'
import { MatchViewerSession } from '../game/viewer/session'
import { findPlayerAt, projectPitch } from '../game/viewer/geometry'
import { renderMatchFrame } from '../game/viewer/renderer'
import { calculateFrameAdvance, formatDiagnosticTime } from '../game/viewer/pacing'
import type { PlaybackSpeed } from '../game/viewer/pacing'
import { PROJECT_PHASE } from './project'
import './App.css'

type FeedItem = { tick: number; title: string; detail: string; kind: 'contact' | 'kick' }

function contactFeed(state: MatchState): FeedItem[] {
  const automatic: FeedItem[] = state.automaticContactEvents.map(e => ({
    tick: e.tick,
    title: e.outcome.replace(/([A-Z])/g, ' $1').toUpperCase(),
    detail: e.playerId.replaceAll('_', ' ') + ' · ' + e.kind,
    kind: 'contact',
  }))
  const explicit: FeedItem[] = state.contactEvents
    .filter(e => e.outcome !== 'outOfReach' && e.outcome !== 'occupied')
    .map(e => ({
      tick: e.tick, title: e.outcome.toUpperCase(),
      detail: e.playerId.replaceAll('_', ' ') + ' · ' + e.kind,
      kind: e.kind === 'kick' ? 'kick' : 'contact',
    }))
  return [...automatic, ...explicit]
    .sort((a, b) => b.tick - a.tick)
    .slice(0, 5)
}

export default function App() {
  const sessionRef = useRef<MatchViewerSession | null>(null)
  if (sessionRef.current === null) sessionRef.current = new MatchViewerSession()
  const session = sessionRef.current
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hud, setHud] = useState<MatchState>(session.state)
  const [renderRevision, setRenderRevision] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden) setRunning(false)
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => document.removeEventListener('visibilitychange', stopWhenHidden)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const currentSession = sessionRef.current
    if (!canvas || !currentSession) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      setFailure('This browser cannot open the 2D Canvas renderer.')
      return
    }

    let frame = 0
    let lastTime: number | null = null
    let lastHud = 0
    let remainderMs = 0
    let width = 0
    let height = 0
    let cancelled = false

    function resize() {
      if (!canvas || !ctx) return
      const rect = canvas.getBoundingClientRect()
      width = Math.max(0, rect.width)
      height = Math.max(0, rect.height)
      if (width === 0 || height === 0) return
      // Cap backing pixels on Retina iPhones and large desktop monitors.
      const dpr = Math.min(window.devicePixelRatio || 1, 2,
        2048 / width, 1400 / height)
      const pixelsWide = Math.max(1, Math.round(width * dpr))
      const pixelsHigh = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
        canvas.width = pixelsWide
        canvas.height = pixelsHigh
      }
      ctx.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0)
      draw(1)
    }

    function draw(alpha: number) {
      if (!ctx || !currentSession || width <= 0 || height <= 0) return
      renderMatchFrame(ctx, {
        latest: currentSession.state,
        previous: currentSession.previous,
        setup: currentSession.setup,
        width, height,
        alpha,
        selectedPlayerId: selectedId,
      })
    }

    function loop(now: number) {
      if (cancelled || !currentSession) return
      if (lastTime === null) lastTime = now
      const delta = now - lastTime
      lastTime = now
      const framePlan = calculateFrameAdvance(remainderMs, delta, speed)
      remainderMs = framePlan.remainderMs
      try {
        if (framePlan.steps > 0) currentSession.advance(framePlan.steps)
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'Simulation stopped unexpectedly.')
        setRunning(false)
        return
      }

      // Every drawn position is interpolated strictly from adjacent engine snapshots.
      draw(Math.max(0, Math.min(1, remainderMs / 50)))
      if (now - lastHud >= 140) {
        setHud(currentSession.state)
        lastHud = now
      }
      frame = window.requestAnimationFrame(loop)
    }

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resize) : null
    observer?.observe(canvas)
    window.addEventListener('resize', resize)
    resize()

    if (running) frame = window.requestAnimationFrame(loop)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [running, speed, selectedId, renderRevision])

  const reset = () => {
    const fresh = new MatchViewerSession()
    sessionRef.current = fresh
    setRunning(false)
    setFailure(null)
    setHud(fresh.state)
    setSelectedId(null)
    setRenderRevision(n => n + 1)
  }

  const stepOne = () => {
    if (running) return
    try {
      const next = sessionRef.current?.advance(1)
      if (next) setHud(next)
      setRenderRevision(n => n + 1)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not advance simulation.')
    }
  }

  const selectFromPitch = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const active = sessionRef.current
    if (!canvas || !active) return
    const rect = canvas.getBoundingClientRect()
    const id = findPlayerAt({
      x: event.clientX - rect.left, y: event.clientY - rect.top,
    }, active.state, projectPitch(rect.width, rect.height, active.setup.pitch))
    setSelectedId(id)
  }

  const selected = hud.players.find(player => player.playerId === selectedId)
  const playerDefinition = session.setup.players.find(p => p.id === selectedId)
  const decision = hud.ai.decisionSnapshot.find(d => d.playerId === selectedId)
  const currentOwner = hud.players.find(player => player.playerId === hud.ball.controllerId)
  const ownerTeam = hud.teams.find(t => t.clubId === currentOwner?.clubId)
  const events = contactFeed(hud)
  const connected = hud.ai.enabledTeams.filter(Boolean).length
  const airborne = hud.ball.heightM > 0.28

  return (
    <main className="game-shell">
      <header className="game-topbar">
        <div className="game-identity">
          <div className="o11-symbol" aria-hidden="true">O<span>11</span></div>
          <div className="brand-copy"><strong>O11</strong><span>FOOTBALL MANAGER</span></div>
          <span className="version-tag">ENGINE / {PROJECT_PHASE}</span>
        </div>
        <div className="game-top-middle">
          <span className="live-indicator"><span className={running ? 'live-dot is-live' : 'live-dot'} /> {running ? 'SIMULATING' : 'PAUSED'}</span>
          <span className="top-separator" />
          <span className="top-game-type">11V11 PHYSICS LAB</span>
        </div>
        <div className="top-actions">
          <span className="diagnostic-tag">DEVELOPMENT BUILD</span>
          <a className="repo-link" target="_blank" rel="noreferrer"
             href="https://github.com/sm75z697k8-droid/O11-Football-Manager"
             aria-label="Open O11 GitHub repository">↗</a>
        </div>
      </header>

      <section className="match-header" aria-label="Simulation fixture">
        <div className="club-identity club-home">
          <span className="team-mark team-mark-home">H</span>
          <div><small>HOME · FICTIONAL</small><strong>Harbor Athletic</strong></div>
        </div>
        <div className="match-middle">
          <span className="neutral-score">— <i>:</i> —</span>
          <span className="no-rules-label">NO OFFICIAL SCORE · PHYSICS DEMO</span>
        </div>
        <div className="club-identity club-away">
          <div><small>AWAY · FICTIONAL</small><strong>Vale Rovers</strong></div>
          <span className="team-mark team-mark-away">V</span>
        </div>
      </section>

      <div className="game-main">
        <section className="pitch-panel" aria-label="Live physics simulation pitch">
          <div className="pitch-head">
            <span><span className="green-led" /> TACTICAL VIEW <span className="pitch-head-secondary">/ REAL ENGINE STATE</span></span>
            <span className="pitch-head-right">105 × 68 M <span className="pitch-head-secondary">• 20 HZ LOGIC</span></span>
          </div>

          <div className="canvas-container">
            <canvas
              ref={canvasRef}
              onClick={selectFromPitch}
              aria-label="Top-down football pitch displaying real positions of 22 simulated players and the ball. Select a player by tapping its marker or using the player selector."
              role="img"
            />
            <div className="canvas-label top-left">SIMULATION / NOT A COMPETITIVE MATCH</div>
            <div className="canvas-label top-right">{hud.ball.outsidePitch ? 'BALL OUT OF PLAY' : airborne ? 'BALL AIRBORNE' : 'BALL IN FIELD'}</div>
            <div className="canvas-watermark">O11 <span>•</span> LAB</div>
            {failure && <div className="engine-error" role="alert">{failure}</div>}
          </div>
          <div className="pitch-foot">
            <span><i className="legend-dot harbor-dot" /> HARBOR <i className="legend-dot vale-dot" /> VALE <i className="legend-ring" /> BALL OWNER</span>
            <span>TAP PLAYER TO INSPECT</span>
          </div>
        </section>

        <aside className="insights-panel" aria-label="Simulation telemetry">
          <div className="side-section overview-section">
            <div className="section-title"><span>SIMULATION DATA</span><span className="tiny-index">01 / ENGINE</span></div>
            <div className="metric-big">
              <span className="metric-caption">ELAPSED SIMULATION TIME</span>
              <strong>{formatDiagnosticTime(hud.clock.tick)}</strong>
              <span className="metric-suffix">NOT AN OFFICIAL MATCH CLOCK</span>
            </div>
            <div className="overview-stats">
              <div><small>AGENT TEAMS</small><strong>{connected}<span>/2</span></strong></div>
              <div><small>PHYSICAL TOUCHES</small><strong>{hud.automaticContactEvents.length + hud.contactEvents.filter(e =>
                ['controlled', 'miscontrolled', 'kicked'].includes(e.outcome)).length}</strong></div>
            </div>
            <div className="possession-readout">
              <span>PHYSICAL BALL OWNER</span>
              <strong>{currentOwner ? (ownerTeam?.clubId === session.setup.clubs[0].id ? 'HARBOR' : 'VALE') + ' · #' + currentOwner.shirtNumber : 'UNCONTROLLED'}</strong>
            </div>
          </div>

          <div className="side-section inspection-section">
            <div className="section-title"><span>PLAYER INSPECTOR</span><span className="tiny-index">02 / LIVE</span></div>
            <label htmlFor="player-select" className="field-label">TRACK A PLAYER</label>
            <select id="player-select" value={selectedId ?? ''} onChange={e => setSelectedId(e.target.value || null)} className="player-select">
              <option value="">Select player</option>
              {session.setup.clubs.map(club => (
                <optgroup key={club.id} label={club.name}>
                  {hud.players.filter(player => player.clubId === club.id).map(player => (
                    <option key={player.playerId} value={player.playerId}>#{player.shirtNumber} {player.formationSlot}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selected && playerDefinition ? (
              <div className="selected-details">
                <div className="selected-head">
                  <span className={selected.clubId === session.setup.clubs[0].id ? 'selected-number home-num' : 'selected-number away-num'}>{selected.shirtNumber}</span>
                  <div><strong>{playerDefinition.profile.fullName}</strong><small>{selected.formationSlot} · {selected.role.replace(/([A-Z])/g, ' $1')}</small></div>
                </div>
                <div className="player-values">
                  <div><small>ACTION</small><strong>{decision?.action.toUpperCase() ?? 'MANUAL / IDLE'}</strong></div>
                  <div><small>SPEED</small><strong>{Math.hypot(selected.velocity.xMps, selected.velocity.yMps).toFixed(1)} <em>m/s</em></strong></div>
                </div>
              </div>
            ) : (
              <div className="empty-selection"><span className="target-glyph">⌖</span><p>Tap a player on the pitch to inspect their movement and decision.</p></div>
            )}
          </div>

          <div className="side-section event-section">
            <div className="section-title"><span>PHYSICAL EVENTS</span><span className="tiny-index">03 / LOG</span></div>
            <div className="event-list" aria-label="Actual physical contact events">
              {events.length ? events.map((event, index) => (
                <div key={event.kind + event.tick + event.title + index} className="event-row">
                  <span className={event.kind === 'kick' ? 'event-icon kick-icon' : 'event-icon'}>{event.kind === 'kick' ? '↗' : '◎'}</span>
                  <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                  <time>{formatDiagnosticTime(event.tick)}</time>
                </div>
              )) : (
                <p className="empty-events">No physical contacts yet. Start the engine to observe actual interactions.</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="game-toolbar">
        <div className="toolbar-left">
          <span className="toolbar-kicker">SIMULATION CONTROL</span>
          <div className="play-group">
            <button className={running ? 'play-button playing' : 'play-button'} type="button" onClick={() => setRunning(value => !value)} disabled={Boolean(failure)} aria-label={running ? 'Pause simulation' : 'Play simulation'}>
              <span aria-hidden="true">{running ? 'Ⅱ' : '▶'}</span> {running ? 'PAUSE' : 'PLAY'}
            </button>
            <button type="button" className="step-button" onClick={stepOne} disabled={running || Boolean(failure)} title="Advance exactly one 50ms physics tick">STEP</button>
          </div>
        </div>
        <div className="toolbar-center">
          <span className="toolbar-kicker">PLAYBACK SPEED</span>
          <div className="speed-group" aria-label="Simulation playback speed">
            {([1, 2, 4] as const).map(value => (
              <button type="button" key={value} className={speed === value ? 'speed-active' : ''} onClick={() => setSpeed(value)} aria-pressed={speed === value}>{value}×</button>
            ))}
          </div>
        </div>
        <div className="toolbar-right">
          <span className="hint-text">PHYSICS VISUALIZATION · NO GOALS OR RESTARTS YET</span>
          <button className="reset-button" type="button" onClick={reset}>↺ <span>RESET</span></button>
        </div>
      </footer>
      <div className="orientation-overlay" aria-label="Rotate device for landscape game view">
        <div className="orientation-device" aria-hidden="true"><span /></div>
        <strong>Rotate to landscape</strong>
        <p>O11 is designed for a full-width football management experience.</p>
        <span className="rotate-phase">O11 / ENGINE PHASE {PROJECT_PHASE}</span>
      </div>
    </main>
  )
}
