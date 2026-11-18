import type { MatchSetup } from '../model/match'
import type { MatchState } from '../match/state'
import type { Point2, PitchDefinition } from '../model/pitch'
import { BALL_RADIUS_M } from '../physics/ball'
import {
  projectPitch, projectPoint, interpolatePosition,
} from './geometry'
import type { PitchProjection } from './geometry'

export interface FrameScene {
  readonly latest: MatchState
  readonly previous: MatchState
  readonly setup: MatchSetup
  readonly width: number
  readonly height: number
  readonly alpha: number
  readonly selectedPlayerId: string | null
}

const FIELD_LINE = 'rgba(234,255,236,0.76)'

function drawMarkings(
  ctx: CanvasRenderingContext2D,
  projection: PitchProjection, length: number, width: number,
): void {
  const p = (xM: number, yM: number) => projectPoint({ xM, yM }, projection)
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const a = p(x1, y1)
    const b = p(x2, y2)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  const rectangle = (xM: number, yM: number, wM: number, hM: number) => {
    const corner = p(xM, yM)
    ctx.strokeRect(corner.x, corner.y, wM * projection.scale, hM * projection.scale)
  }

  ctx.lineWidth = Math.max(0.85, Math.min(1.3, projection.scale * 0.13))
  ctx.strokeStyle = FIELD_LINE
  ctx.fillStyle = FIELD_LINE

  rectangle(0, 0, length, width)
  line(length / 2, 0, length / 2, width)

  const centre = p(length / 2, width / 2)
  ctx.beginPath()
  ctx.arc(centre.x, centre.y, 9.15 * projection.scale, 0, Math.PI * 2)
  ctx.stroke()
  for (const spot of [centre, p(11, width / 2), p(length - 11, width / 2)]) {
    ctx.beginPath()
    ctx.arc(spot.x, spot.y, Math.max(1, projection.scale * 0.27), 0, Math.PI * 2)
    ctx.fill()
  }

  // Real-world penalty and six-yard area dimensions, centred on each goal.
  const boxWidth = Math.min(40.32, width * 0.82)
  const sixWidth = Math.min(18.32, width * 0.55)
  for (const right of [false, true]) {
    rectangle(right ? length - 16.5 : 0, (width - boxWidth) / 2, 16.5, boxWidth)
    rectangle(right ? length - 5.5 : 0, (width - sixWidth) / 2, 5.5, sixWidth)
    const goalCentre = p(right ? length : 0, width / 2)
    ctx.fillStyle = 'rgba(226,243,239,0.25)'
    ctx.fillRect(
      right ? goalCentre.x : goalCentre.x - projection.scale * 2,
      goalCentre.y - 3.66 * projection.scale,
      2 * projection.scale, 7.32 * projection.scale,
    )
  }
  ctx.fillStyle = FIELD_LINE
}

/**
 * Fill the entire canvas with a quiet stadium apron and stand textures,
 * then contain a geometrically accurate football pitch in the viewport.
 * Never stretch one coordinate axis or clip players just to fill a screen.
 */
function drawStadiumBackdrop(
  ctx: CanvasRenderingContext2D, projection: PitchProjection,
  viewportWidth: number, viewportHeight: number,
): void {
  const right = projection.x + projection.width
  const surface = ctx.createLinearGradient(0, 0, 0, viewportHeight)
  surface.addColorStop(0, '#253b36')
  surface.addColorStop(0.5, '#263b34')
  surface.addColorStop(1, '#122822')
  ctx.fillStyle = surface
  ctx.fillRect(0, 0, viewportWidth, viewportHeight)

  // The reference shows three long, horizontally ribbed silver-white roof
  // bays on EACH goal end, joined by tapered transverse white beams.
  // Keep all geometry strictly inside the goal-end aprons: the existing field,
  // pitch projection, markings and match engine are never affected.
  const endStands = [
    { x: 0, width: projection.x, rightSide: false },
    { x: right, width: viewportWidth - right, rightSide: true },
  ]
  const sections = [0, 0.28, 0.72, 1]

  for (const { x, width, rightSide } of endStands) {
    if (width < 4) continue
    const innerEdge = rightSide ? x : x + width
    const outerEdge = rightSide ? x + width : x

    // Ribbed roof panels. Each bay shades from light silver to muted grey,
    // following the horizontal, stepped appearance of the supplied image.
    for (let bay = 0; bay < sections.length - 1; bay += 1) {
      const top = viewportHeight * sections[bay]
      const bottom = viewportHeight * sections[bay + 1]
      const panel = ctx.createLinearGradient(x, top, x, bottom)
      panel.addColorStop(0, '#eeeeed')
      panel.addColorStop(0.22, '#e3e4e2')
      panel.addColorStop(0.72, '#d1d3d2')
      panel.addColorStop(1, '#c4c7c6')
      ctx.fillStyle = panel
      ctx.fillRect(x, top, width, bottom - top)

      // Fine horizontal corrugations, not stadium seat rows. Static Canvas
      // shapes avoid texture downloads and remain inexpensive on iPhone.
      const ribSpacing = Math.max(5.5, Math.min(9, viewportHeight * 0.011))
      for (let y = top + 3; y < bottom - 2; y += ribSpacing) {
        ctx.fillStyle = 'rgba(106, 114, 113, 0.14)'
        ctx.fillRect(x + 2, y, Math.max(0, width - 4), 0.85)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
        ctx.fillRect(x + 2, y + 1.25, Math.max(0, width - 4), 0.9)
      }
    }

    // In the reference, three bright projecting cross beams divide the
    // panels. Their tips are thicker at the pitch-facing edge and taper
    // towards the outside wall; mirror the geometry at the opposite goal.
    for (const fraction of [0.28, 0.72, 0.955]) {
      const y = viewportHeight * fraction
      const beamThickness = Math.max(4, Math.min(10, viewportHeight * 0.017))
      ctx.fillStyle = 'rgba(86, 91, 91, 0.18)'
      ctx.fillRect(x, y + beamThickness * 0.55, width, beamThickness * 0.62)

      const beam = ctx.createLinearGradient(outerEdge, y, innerEdge, y)
      beam.addColorStop(0, '#e2e3e1')
      beam.addColorStop(0.48, '#f5f5f4')
      beam.addColorStop(1, '#ffffff')
      ctx.fillStyle = beam
      ctx.beginPath()
      ctx.moveTo(outerEdge, y - beamThickness * 0.22)
      ctx.lineTo(innerEdge, y - beamThickness * 0.58)
      ctx.lineTo(innerEdge, y + beamThickness * 0.52)
      ctx.lineTo(outerEdge, y + beamThickness * 0.12)
      ctx.fill()
    }

    // Slim silver fascia between the white roof and the dark pitch apron.
    // Drawn inside each end stand, never over the field.
    ctx.fillStyle = 'rgba(103, 112, 112, 0.30)'
    ctx.fillRect(rightSide ? innerEdge : innerEdge - 3, 0,
      Math.min(3, width), viewportHeight)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.54)'
    ctx.fillRect(rightSide ? innerEdge + 3 : innerEdge - 4, 0,
      Math.min(1, width), viewportHeight)
  }
}

function drawPitch(
  ctx: CanvasRenderingContext2D, projection: PitchProjection,
  length: number, width: number,
): void {
  const { x, y, height, scale } = projection
  // A slight perimeter strip gives the touchline separation from stands.
  ctx.fillStyle = '#0c241d'
  ctx.fillRect(x - 5, y - 5, projection.width + 10, projection.height + 10)
  ctx.fillStyle = '#2a6a42'
  ctx.fillRect(x, y, projection.width, height)

  // Subtle checkerboard mowing pattern similar to professional 2D viewers.
  const columns = 12
  const rows = 8
  const cellW = projection.width / columns
  const cellH = projection.height / rows
  for (let c = 0; c < columns; c += 1) {
    for (let row = 0; row < rows; row += 1) {
      if ((c + row) % 2 === 0) {
        ctx.fillStyle = '#317449'
        ctx.fillRect(x + c * cellW, y + row * cellH, cellW + .3, cellH + .3)
      }
    }
  }
  // Width remains pitch width*scale: markings and player coordinates
  // use the SAME geometry as the hit-testing system.
  void scale
  drawMarkings(ctx, projection, length, width)
}

/**
 * A static, non-interactive stadium scene.
 *
 * Draws only the existing stands, empty turf and accurate field markings.
 * Deliberately requires no MatchState, players, ball, or simulation clock.
 */
export function renderStadiumOnly(
  ctx: CanvasRenderingContext2D,
  pitch: PitchDefinition, width: number, height: number,
): void {
  if (width <= 0 || height <= 0) return
  ctx.clearRect(0, 0, width, height)
  const projection = projectPitch(width, height, pitch)
  drawStadiumBackdrop(ctx, projection, width, height)
  if (projection.scale <= 0) return
  drawPitch(ctx, projection, pitch.lengthM, pitch.widthM)
}

function drawSelection(
  ctx: CanvasRenderingContext2D, from: Point2,
  target: Point2 | null, projection: PitchProjection,
): void {
  if (target !== null) {
    const a = projectPoint(from, projection)
    const b = projectPoint(target, projection)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,234,161,.68)'
    ctx.lineWidth = 1.1
    ctx.setLineDash([4, 5])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = 'rgba(255,234,161,.85)'
    ctx.beginPath()
    ctx.arc(b.x, b.y, 2.3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** All player / ball coordinates below come directly from MatchState. */
export function renderMatchFrame(ctx: CanvasRenderingContext2D, scene: FrameScene): void {
  const { width, height, latest, previous, setup, selectedPlayerId } = scene
  if (width <= 0 || height <= 0) return

  ctx.clearRect(0, 0, width, height)
  const projection = projectPitch(width, height, setup.pitch)
  drawStadiumBackdrop(ctx, projection, width, height)
  if (projection.scale <= 0) return
  drawPitch(ctx, projection, setup.pitch.lengthM, setup.pitch.widthM)

  const previousById = new Map(previous.players.map(p => [p.playerId, p]))
  const alpha = Math.max(0, Math.min(1, scene.alpha))
  const teamColors = new Map(setup.clubs.map(c => [c.id, c.colors.primary]))
  const ownerId = latest.ball.controllerId

  const selected = latest.players.find(p => p.playerId === selectedPlayerId)
  if (selected) {
    const previousSelected = previousById.get(selected.playerId) ?? selected
    const position = interpolatePosition(previousSelected.position, selected.position, alpha)
    drawSelection(ctx, position,
      selected.intention.kind === 'moveToPoint' ? selected.intention.target : null,
      projection)
  }

  const radius = Math.max(6, Math.min(11, projection.scale * 1.35))
  for (const player of latest.players) {
    const previousPlayer = previousById.get(player.playerId) ?? player
    const location = interpolatePosition(previousPlayer.position, player.position, alpha)
    const projected = projectPoint(location, projection)
    const isOwner = player.playerId === ownerId
    const isSelected = player.playerId === selectedPlayerId

    ctx.fillStyle = 'rgba(2,10,14,.38)'
    ctx.beginPath()
    ctx.ellipse(projected.x + 1, projected.y + radius * .47,
      radius * 1.05, radius * .49, 0, 0, Math.PI * 2)
    ctx.fill()

    if (isSelected || isOwner) {
      ctx.strokeStyle = isSelected ? '#fff0a9' : '#eefff6'
      ctx.lineWidth = isSelected ? 2.5 : 1.7
      ctx.beginPath()
      ctx.arc(projected.x, projected.y, radius + (isSelected ? 5 : 3), 0, Math.PI * 2)
      ctx.stroke()
    }

    // Small orientation indicator comes from the player's real heading.
    ctx.fillStyle = 'rgba(244,255,247,.85)'
    const arrowX = projected.x + Math.cos(player.orientationRad) * (radius + 3.6)
    const arrowY = projected.y + Math.sin(player.orientationRad) * (radius + 3.6)
    ctx.beginPath()
    ctx.arc(arrowX, arrowY, Math.max(1.6, radius * .21), 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = teamColors.get(player.clubId) ?? '#b7bfc1'
    ctx.strokeStyle = player.formationSlot === 'GK' ? '#eaffdd' : 'rgba(255,255,255,.77)'
    ctx.lineWidth = player.formationSlot === 'GK' ? 2.4 : 1
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#07181d'
    ctx.font = '700 ' + Math.max(7, Math.min(10, radius * .98)) + 'px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(player.shirtNumber), projected.x, projected.y + .5)
  }

  const ballPosition = interpolatePosition(previous.ball.position,
    latest.ball.position, alpha)
  const ball = projectPoint(ballPosition, projection)
  const heightM = previous.ball.heightM +
    (latest.ball.heightM - previous.ball.heightM) * alpha
  const airborne = Math.max(0, heightM - BALL_RADIUS_M)
  const elevation = Math.min(23, airborne * projection.scale * .55)

  ctx.fillStyle = 'rgba(3,9,9,.58)'
  ctx.beginPath()
  ctx.ellipse(ball.x + 1, ball.y + 2.5, 4.6, 2.1, 0, 0, Math.PI * 2)
  ctx.fill()

  if (airborne > 0.18) {
    ctx.strokeStyle = 'rgba(239,255,240,.38)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ball.x, ball.y)
    ctx.lineTo(ball.x, ball.y - elevation)
    ctx.stroke()
  }

  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#101b19'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(ball.x, ball.y - elevation, Math.max(3, radius * .45), 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
