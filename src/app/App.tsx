import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { MatchState } from '../game/match/state'
import { MatchViewerSession } from '../game/viewer/session'
import { GOALKEEPER_COMPARISON_PROFILES } from '../data/fixtures/keeper-comparison'
import type { ExhibitionPreset } from '../data/fixtures/keeper-comparison'
import { copyableMatchDiagnostics } from '../game/viewer/match-diagnostics'
import { MAX_COMMANDS_PER_MATCH } from '../game/match/commands'
import { PROJECT_PHASE } from './project'
import { distinctMatchSeed } from '../game/core/match-variation'
import { AI_PASS_MIN_INTERVAL_TICKS, evaluateOnBallPlan } from '../game/ai/possession'
import { findPlayerAt, projectPitch } from '../game/viewer/geometry'
import { renderMatchFrame } from '../game/viewer/renderer'
import { calculateFrameAdvance } from '../game/viewer/pacing'
import { formatMatchTime, formatMatchEventTime } from '../game/match/periods'
import type { PlaybackSpeed } from '../game/viewer/pacing'
import './App.css'

type OverlayPanel = 'none' | 'players' | 'events' | 'keepers'

const KEEPER_COMPARISON_METRICS = [
  { key: 'reflexes', label: 'Reflexes' },
  { key: 'diving', label: 'Diving' },
  { key: 'handling', label: 'Handling' },
  { key: 'positioning', label: 'Positioning' },
  { key: 'parrying', label: 'Parrying' },
] as const
type FeedItem = {
  readonly key: string
  readonly tick: number
  readonly kind: 'challenge' | 'contact' | 'kick' | 'goal' | 'restart'
  readonly title: string
  readonly detail: string
}

function physicalEvents(state: MatchState): FeedItem[] {
  // Keep only recent items before formatting/sorting. Match history is
  // still preserved by the engine, but an iPhone HUD should not reprocess
  // every contact from the whole exhibition on each 135ms refresh.
  const autoOffset = Math.max(0, state.automaticContactEvents.length - 18)
  const automatic = state.automaticContactEvents
    .slice(autoOffset).map((event, index) => ({
    key: 'auto-' + (index + autoOffset),
    tick: event.tick,
    kind: 'challenge' as const,
    title: event.outcome.replace(/([A-Z])/g, ' $1').toUpperCase(),
    detail: event.playerId.replaceAll('_', ' ') + ' · ' + event.kind,
  }))
  const manualOffset = Math.max(0, state.contactEvents.length - 48)
  const manual = state.contactEvents.slice(manualOffset)
    .filter(event => !['outOfReach', 'occupied', 'invalidDirection'].includes(event.outcome))
    .map((event, index) => ({
      key: 'manual-' + (index + manualOffset),
      tick: event.tick,
      kind: ['kick', 'goalKick', 'cornerKick'].includes(event.kind) ? 'kick' as const : 'contact' as const,
      title: event.outcome.toUpperCase(),
      detail: event.playerId.replaceAll('_', ' ') + ' · ' + event.kind,
    }))
  const goals = state.goalEvents.slice(-14).map((goal, index) => ({
    key: 'goal-' + index,
    tick: goal.tick,
    kind: 'goal' as const,
    title: goal.ownGoal ? 'OWN GOAL' : 'GOAL',
    detail: goal.scoringTeamId.replaceAll('_', ' ') +
      ' · last touch ' + goal.lastTouchPlayerId.replaceAll('_', ' '),
  }))
  const restarts = state.outOfPlayEvents.slice(-12).map(exit => ({
    key: 'out-' + exit.tick,
    tick: exit.tick,
    kind: 'restart' as const,
    title: exit.kind === 'throwIn' ? 'THROW-IN AWARDED' :
      exit.kind === 'corner' ? 'CORNER AWARDED' :
        exit.kind === 'goalKick' ? 'GOAL KICK AWARDED' : 'BALL OUT',
    detail: (exit.awardedTeamId ?? 'UNKNOWN TEAM').replaceAll('_', ' ') +
      ' · ' + exit.side,
  }))
  return [...automatic, ...manual, ...goals, ...restarts].sort((a, b) =>
    b.tick - a.tick || a.key.localeCompare(b.key)).slice(0, 14)
}

export default function App() {
  const sessionRef = useRef<MatchViewerSession | null>(null)
  // New users see a visible goalkeeper contrast; the untouched balanced
  // fixture remains available as a same-seed control in the GK panel.
  if (sessionRef.current === null) sessionRef.current =
    new MatchViewerSession(undefined, 'keeper-comparison')
  const session = sessionRef.current
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<OverlayPanel>('none')
  const [hud, setHud] = useState<MatchState>(session.state)
  const [renderRevision, setRenderRevision] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [diagnosticCopied, setDiagnosticCopied] = useState(false)

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
      // Every real goal now stages a physical conceding-team kickoff.
      // Goal history is a scoreboard, never a reason to end playback.
      const restart = active.state.restart
      const blocked =
        active.state.period === 'halfTime' ||
        active.state.period === 'fullTime' ||
        (restart && !['throwIn','goalKick','corner'].includes(restart.kind)) ||
        (active.state.ball.outsidePitch && restart?.kind !== 'throwIn')
      if (blocked) {
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
    if (playing && active.state.period !== 'halfTime' &&
      active.state.period !== 'fullTime' &&
      (!active.state.ball.outsidePitch ||
        active.state.restart?.kind === 'throwIn')) {
      frame = window.requestAnimationFrame(loop)
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [playing, speed, selectedId, renderRevision])

  const restartWithSeed = (
    seed: number, preset: ExhibitionPreset = sessionRef.current!.preset,
  ) => {
    const fresh = new MatchViewerSession(seed, preset)
    sessionRef.current = fresh
    setPlaying(false)
    setFailure(null)
    setDiagnosticCopied(false)
    setSelectedId(null)
    setPanel('none')
    setHud(fresh.state)
    setRenderRevision(revision => revision + 1)
  }

  const replaySameMatch = () => {
    restartWithSeed(sessionRef.current!.state.seed)
  }

  const changeExhibitionPreset = (next: ExhibitionPreset) => {
    if (sessionRef.current!.preset === next) return
    // Identical seed and team sheets outside GK: the controlled comparison
    // changes abilities only, while the physical match restarts at kickoff.
    restartWithSeed(sessionRef.current!.state.seed, next)
    setPanel('keepers')
  }

  const startNewMatch = () => {
    try {
      // Only the user's NEW MATCH click uses external entropy. Simulation
      // and REPLAY are fully seeded and never depend on wall-clock time.
      const value = window.crypto.getRandomValues(new Uint32Array(1))[0]
      const newSeed = distinctMatchSeed(sessionRef.current!.state.seed, value)
      restartWithSeed(newSeed)
    } catch {
      setFailure('A secure browser random seed is unavailable. You can still replay this match.')
      setPlaying(false)
    }
  }

  const copyMatchReport = () => {
    const report = copyableMatchDiagnostics(sessionRef.current!.state) +
      '\nEXHIBITION PRESET: ' + sessionRef.current!.preset
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(report)
        .then(() => setDiagnosticCopied(true))
        .catch(() => { void window.prompt('Copy match diagnostic report', report) })
    } else {
      void window.prompt('Copy match diagnostic report', report)
    }
  }

  const seedCode = hud.seed.toString(16).toUpperCase().padStart(8, '0')
  const keeperDefinitions = session.setup.clubs.map(club =>
    session.setup.players.find(p =>
      p.clubId === club.id && p.abilities.goalkeeping !== null))
  const keeperComparison = session.preset === 'keeper-comparison'

  const startSecondHalf = () => {
    try {
      const ready = sessionRef.current!.startSecondHalf()
      setHud(ready)
      setPlaying(false)
      setRenderRevision(value => value + 1)
      setPanel('none')
    } catch (error) {
      setFailure(error instanceof Error ? error.message :
        'Could not start the second half.')
    }
  }

  const stepOne = () => {
    if (playing || failure || hud.period === 'halfTime' ||
        hud.period === 'fullTime' ||
        (hud.ball.outsidePitch && hud.restart?.kind !== 'throwIn') ||
        (hud.restart && !['throwIn', 'goalKick', 'corner'].includes(hud.restart.kind))) return
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
  // Only inspect on demand. The normal iPhone Canvas playback never invokes
  // this extra tactical evaluation when the player drawer is closed.
  const forecast = panel === 'players' && selected &&
      selected.playerId === hud.ball.controllerId && !hud.ball.outsidePitch
    ? evaluateOnBallPlan(hud, session.setup,
      hud.clock.tick - hud.ai.lastPassTick >= AI_PASS_MIN_INTERVAL_TICKS, true)
    : null
  const ownerClub = session.setup.clubs.find(club => club.id === owner?.clubId)
  const events = physicalEvents(hud)
  const goal = hud.goalEvents.at(-1)
  const scoringClub = session.setup.clubs.find(c => c.id === goal?.scoringTeamId)
  const out = hud.ball.outsidePitch
  const throwIn = hud.restart?.kind === 'throwIn'
  const goalKick = hud.restart?.kind === 'goalKick'
  const corner = hud.restart?.kind === 'corner'
  const postGoal = hud.postGoalKickoff !== null
  const recentlyScored = !!goal && hud.clock.tick - goal.tick <= 26
  const kickoffClub = session.setup.clubs.find(c =>
    c.id === hud.postGoalKickoff?.teamId)
  const halfTime = hud.period === 'halfTime'
  const fullTime = hud.period === 'fullTime'
  const secondHalfKickoff = hud.periodKickoff !== null
  const blocked = halfTime || fullTime || (out && !throwIn) ||
    (hud.restart !== null && !throwIn && !goalKick && !corner)
  const awarded = session.setup.clubs.find(c =>
    c.id === hud.restart?.awardedTeamId)
  const activeTeam = hud.ai.enabledTeams.filter(Boolean).length
  const successContacts = hud.contactEvents.filter(e =>
    ['controlled', 'miscontrolled', 'kicked', 'thrownIn', 'goalKicked', 'cornerKicked'].includes(e.outcome)).length
  const statuses = failure ? 'ENGINE ERROR' :
    fullTime ? 'FULL-TIME · FINAL RESULT' :
    halfTime ? 'HALF-TIME · CHANGE ENDS' :
    secondHalfKickoff ? 'SECOND-HALF KICK-OFF' :
    postGoal ? 'CENTRE KICK-OFF · ' + (kickoffClub?.shortName ?? 'RESTART') :
    recentlyScored ? 'GOAL · ' + (scoringClub?.shortName ?? 'MATCH') :
    throwIn ? 'THROW-IN · ' + (awarded?.shortName ?? 'RESTART') :
    goalKick ? 'GOAL KICK · ' + (awarded?.shortName ?? 'RESTART') :
    corner ? 'CORNER · ' + (awarded?.shortName ?? 'RESTART') :
    out ? 'OUT OF PLAY · ' + (awarded?.shortName ?? 'MATCH') :
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
            <small>2 × 45 MIN · ADDED TIME</small>
          </div>
          <div className="team-side away-side">
            <span className="team-names"><strong>VAL</strong><small>VALE ROVERS</small></span>
            <span className="team-crest away-crest">V</span>
          </div>
        </div>

        <div className="right-nav">
          <span className="sim-clock" aria-label="Elapsed diagnostic simulation time">
            {formatMatchTime(hud)}
          </span>
          <button
            type="button"
            className={panel === 'keepers' ? 'hud-icon hud-gk-icon selected' : 'hud-icon hud-gk-icon'}
            aria-label="Compare goalkeeper attributes and match presets"
            aria-pressed={panel === 'keepers'}
            onClick={() => setPanel(current => current === 'keepers' ? 'none' : 'keepers')}
          >GK</button>
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
        <span className="caption-divider">/</span>
        <span className="match-seed">SEED {seedCode} · BUILD {PROJECT_PHASE} · {keeperComparison ? 'GK COMPARISON' : 'BALANCED'}</span>
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
        <aside className="overlay-drawer" aria-label={panel === 'players'
          ? 'Player inspector' : panel === 'keepers'
            ? 'Goalkeeper comparison and test setup' : 'Physical event log'}>
          <div className="drawer-head">
            <div><small>O11 MATCH LAB / TELEMETRY</small><strong>{panel === 'players'
              ? 'Player inspector' : panel === 'keepers'
                ? 'Goalkeeper lab' : 'Physical events'}</strong></div>
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
                  {forecast?.choice && (
                    <div className="drawer-ai-forecast" aria-label="Estimated short-horizon AI reasoning">
                      <small>AI THINKING · ESTIMATED, NOT A GUARANTEED RESULT</small>
                      <strong>{forecast.choice.kind.toUpperCase()}
                        {forecast.choice.kind === 'pass'
                          ? ' · ' + (hud.players.find(p => p.playerId ===
                            (forecast.choice?.kind === 'pass'
                              ? forecast.choice.receiverId : ''))?.shirtNumber ?? '?')
                          : ''}
                      </strong>
                      <p>{forecast.selectedReason}</p>
                      <div className="drawer-ai-alternatives">
                        {forecast.assessments.slice(0, 3).map((item, index) => (
                          <span key={index}>
                            {item.choice.kind.toUpperCase()} {item.utility.toFixed(1)}
                            <small>{item.horizonSeconds.toFixed(1)}s</small>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : <p className="drawer-muted">Tap a player on the pitch or choose one above.</p>}
              <div className="drawer-divider" />
              <div className="drawer-stat"><span>ACTIVE AI TEAMS</span><strong>{activeTeam} / 2</strong></div>
              <div className="drawer-stat"><span>PHYSICAL CONTACTS</span><strong>{hud.automaticContactEvents.length + successContacts}</strong></div>
              <div className="drawer-stat"><span>COMMANDS USED</span><strong>{hud.nextCommandSequence - 1} / {MAX_COMMANDS_PER_MATCH}</strong></div>
              <div className="drawer-stat"><span>BUILD</span><strong>{PROJECT_PHASE}</strong></div>
              <button type="button" className="drawer-debug-copy" onClick={copyMatchReport}>
                {diagnosticCopied ? '✓ Debug report copied' : 'Copy match debug report'}
              </button>
              <div className="drawer-stat"><span>BALL CONTROLLER</span><strong>{owner ? ownerClub?.shortName + ' #' + owner.shirtNumber : 'NONE'}</strong></div>
              <p className="drawer-legal">Goals are recorded only when the physical ball crosses the goalmouth. This exhibition has physical throw-ins, goal kicks and corners. Kickoffs after goals and full match periods are not implemented yet.</p>
            </div>
          ) : panel === 'keepers' ? (
            <div className="drawer-content keeper-lab">
              <p className="drawer-muted">
                Fictional profiles for testing real goalkeeper AI.
                Switching profiles resets the match to kickoff with the
                <strong> same seed</strong>.
              </p>
              <div className="keeper-preset-switch" role="group" aria-label="Goalkeeper test fixture">
                <button type="button" aria-pressed={!keeperComparison}
                  className={!keeperComparison ? 'active' : ''}
                  onClick={() => changeExhibitionPreset('balanced')}>Balanced</button>
                <button type="button" aria-pressed={keeperComparison}
                  className={keeperComparison ? 'active' : ''}
                  onClick={() => changeExhibitionPreset('keeper-comparison')}>GK comparison</button>
              </div>
              <table className="keeper-stat-table" aria-label="Actual fictional goalkeeper ratings">
                <thead>
                  <tr><th scope="col">RATING</th><th scope="col">HAR</th><th scope="col">VAL</th></tr>
                </thead>
                <tbody>
                  {KEEPER_COMPARISON_METRICS.map(metric => (
                    <tr key={metric.key}>
                      <th scope="row">{metric.label}</th>
                      {keeperDefinitions.map(keeper => (
                        <td key={keeper!.id}>{keeper!.abilities.goalkeeping![metric.key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {keeperComparison ? (
                <div className="keeper-role-notes">
                  <p><strong>HAR · {GOALKEEPER_COMPARISON_PROFILES.club_harbor.title}</strong>
                    {GOALKEEPER_COMPARISON_PROFILES.club_harbor.summary}</p>
                  <p><strong>VAL · {GOALKEEPER_COMPARISON_PROFILES.club_vale.title}</strong>
                    {GOALKEEPER_COMPARISON_PROFILES.club_vale.summary}</p>
                </div>
              ) : (
                <p className="drawer-muted keeper-control-note">
                  Both goalkeepers use identical 68-rated goalkeeping attributes
                  in the balanced control fixture.
                </p>
              )}
              <p className="drawer-legal">
                Ratings are estimated 0–100 abilities, not save percentages.
                The outfield players, formation, pressing and physics are unchanged.
                Different ratings can change the match sequence even with the same seed.
              </p>
            </div>
          ) : (
            <div className="drawer-content event-feed">
              {events.length ? events.map(event => (
                <div className="drawer-event" key={event.key}>
                  <span className="event-symbol">{event.kind === 'goal' ? '★' : event.kind === 'kick' ? '↗' : '●'}</span>
                  <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                  <time>{formatMatchEventTime(hud, event.tick)}</time>
                </div>
              )) : <p className="drawer-muted">No physical contact has happened yet. Press Play to watch the simulation.</p>}
            </div>
          )}
        </aside>
      )}

      {(blocked || failure) && (
        <section className="stoppage-overlay" role="status" aria-live="polite">
          <span className="stoppage-kicker">{failure ? 'SIMULATION ERROR' :
            fullTime ? 'REFEREE · FULL-TIME' :
              halfTime ? 'REFEREE · HALF-TIME' : 'BALL OUT OF PLAY'}</span>
          <strong>{failure ? 'The engine stopped' :
            fullTime ? 'FULL-TIME · ' +
              hud.teams[0].score + ' : ' + hud.teams[1].score :
            halfTime ? 'Half-time · Change ends' :
              'Awaiting football restarts'}</strong>
          <p>{failure ?? (halfTime
            ? 'The first half and its added time have ended. The teams will change ends and the other team will take a physical second-half kick-off.'
            : fullTime
              ? 'The referee has ended the two 45-minute halves, including measured added time. This result is based on physically scored goals.'
              : 'The ball left play without an actionable restart award.')}</p>
          <div className="stoppage-actions">
            {halfTime && !failure && (
              <button type="button" className="stoppage-new-match"
                onClick={startSecondHalf}>▶ Start second half</button>
            )}
            <button type="button" onClick={replaySameMatch}>↺ Replay same</button>
            <button type="button" className="stoppage-new-match"
              onClick={startNewMatch}>New match</button>
          </div>
        </section>
      )}

      <footer className="floating-transport">
        <div className="transport-identity">
          <span className="transport-title">O11 <span>/</span> SIM</span>
          <span className="transport-subtitle">SEED {seedCode}</span>
        </div>
        <div className="transport-controls" aria-label="Simulation playback">
          <button type="button" className={playing ? 'transport-primary playing' : 'transport-primary'}
            onClick={() => setPlaying(value => !value)}
            disabled={Boolean(failure) || blocked}
            aria-label={playing ? 'Pause simulation' : 'Start simulation'}>
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><strong>{playing ? 'PAUSE' : 'PLAY'}</strong>
          </button>
          <button type="button" className="transport-secondary"
            onClick={stepOne} disabled={playing || Boolean(failure) || blocked}
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
          <button type="button" className="transport-replay"
            onClick={replaySameMatch}
            title="Same seed, exactly the same match"
            aria-label="Replay the same seeded match">↺ REPLAY</button>
          <button type="button" className="transport-new-match"
            onClick={startNewMatch}
            title="New seed, new possible match sequence"
            aria-label="Start a new match with a different simulation seed">NEW MATCH</button>
        </div>
        <div className="transport-tail">
          <span>{fullTime ? 'MATCH FINISHED' :
            halfTime ? 'HALF-TIME INTERVAL' :
            secondHalfKickoff ? 'SECOND HALF KICKOFF' :
            postGoal ? 'CONCEDING TEAM KICKOFF' :
            recentlyScored ? 'GOAL CONFIRMED' :
            throwIn ? 'THROW-IN PREPARATION' :
            goalKick ? 'GOAL KICK PREPARATION' :
            corner ? 'CORNER PREPARATION' :
            out ? 'OUT OF PLAY' : '20 HZ PHYSICS'}</span>
          <small>45 + ADDED · HALF-TIME · 45 + ADDED</small>
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
