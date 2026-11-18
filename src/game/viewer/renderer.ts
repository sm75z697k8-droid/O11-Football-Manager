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

  // Two muted spectator aprons behind the goals. The repeated seat rows
  // have no gameplay significance and consume no image/network resources.
  const wings: [number, number, boolean][] = [
    [0, projection.x, false],
    [right, Math.max(0, viewportWidth - right), true],
  ]
  for (const [origin, breadth, rightSide] of wings) {
    if (breadth < 3) continue
    const grad = ctx.createLinearGradient(origin, 0, origin + breadth, 0)
    if (rightSide) {
      grad.addColorStop(0, '#244038')
      grad.addColorStop(0.14, '#24352f')
      grad.addColorStop(1, '#101c1c')
    } else {
      grad.addColorStop(0, '#101c1c')
      grad.addColorStop(.86, '#24352f')
      grad.addColorStop(1, '#244038')
    }
    ctx.fillStyle = grad
    ctx.fillRect(origin, 0, breadth, viewportHeight)
    const tierWidth = Math.max(0, breadth - 17)
    const tierX = rightSide ? origin + 17 : origin
    ctx.fillStyle = 'rgba(233,238,226,0.043)'
    for (let row = 9; row < viewportHeight; row += 10) {
      ctx.fillRect(tierX, row, tierWidth, 2)
    }
    ctx.fillStyle = 'rgba(0,0,0,.17)'
    for (let row = 4; row < viewportHeight; row += 41) {
      ctx.fillRect(tierX, row, tierWidth, 1)
    }
  }
}


/**
 * Lightweight, stationary pearl-white tensile roof planes above the two
 * goal-end stands. Every point stays outside the projected touchline/goal
 * rectangle, so the roof cannot obscure the pitch or match interactions.
 * The long side stands deliberately remain uncovered.
 */
function drawGoalEndCanopies(
  ctx: CanvasRenderingContext2D, projection: PitchProjection,
  viewportWidth: number, viewportHeight: number,
): void {
  const ends = [
    { edgeX: projection.x, breadth: projection.x, direction: -1 },
    {
      edgeX: projection.x + projection.width,
      breadth: viewportWidth - projection.x - projection.width,
      direction: 1,
    },
  ]

  for (const { edgeX, breadth, direction } of ends) {
    // Leave the seating visible. Never squeeze a roof into a portrait apron.
    if (breadth < 50 || viewportHeight < 180) continue

    const insetY = Math.max(11, Math.min(28, viewportHeight * 0.07))
    const outerMargin = Math.max(6, Math.min(14, breadth * 0.085))
    const roofWidth = Math.min(76, breadth * 0.34)
    // direction faces away from the pitch; inward points back towards it.
    const inward = -direction
    const outerX = edgeX + direction * (breadth - outerMargin)
    const innerX = outerX + inward * roofWidth
    const frontY = viewportHeight - insetY

    // Small cast shadow on the exposed terrace; no roof touches the pitch.
    ctx.fillStyle = 'rgba(5, 17, 20, 0.18)'
    ctx.fillRect(
      Math.min(innerX, innerX + inward * 10),
      insetY + 13, 10, viewportHeight - 2 * insetY - 26,
    )

    const fabric = ctx.createLinearGradient(outerX, 0, innerX, 0)
    fabric.addColorStop(0, '#d8e1de')
    fabric.addColorStop(0.38, '#f5f8f6')
    fabric.addColorStop(0.76, '#e9f0ed')
    fabric.addColorStop(1, '#bccdca')
    ctx.fillStyle = fabric
    ctx.beginPath()
    ctx.moveTo(outerX, insetY + 12)
    ctx.lineTo(outerX + inward * roofWidth * 0.76, insetY)
    ctx.lineTo(innerX - inward * 2, insetY + 24)
    // Gentle taper in the fabric lip, rather than a massive white block.
    ctx.lineTo(innerX + inward * 2, viewportHeight * 0.32)
    ctx.lineTo(innerX + inward * 4, viewportHeight * 0.5)
    ctx.lineTo(innerX + inward * 2, viewportHeight * 0.68)
    ctx.lineTo(innerX - inward * 2, frontY - 24)
    ctx.lineTo(outerX + inward * roofWidth * 0.76, frontY)
    ctx.lineTo(outerX, frontY - 12)
    ctx.lineTo(outerX, insetY + 12)
    ctx.fill()

    // Just a few light membrane seams, aligned across the short-end stand.
    const seamPitch = Math.max(55, viewportHeight / 6)
    for (let y = insetY + 40; y < frontY - 30; y += seamPitch) {
      ctx.strokeStyle = 'rgba(92, 119, 119, 0.24)'
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(outerX + inward * 6, y)
      ctx.lineTo(innerX - inward * 5, y)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(234, 244, 242, 0.8)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(innerX - inward * 2, insetY + 24)
    ctx.lineTo(innerX + inward * 2, viewportHeight * 0.32)
    ctx.lineTo(innerX + inward * 4, viewportHeight * 0.5)
    ctx.lineTo(innerX + inward * 2, viewportHeight * 0.68)
    ctx.lineTo(innerX - inward * 2, frontY - 24)
    ctx.stroke()
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
  drawGoalEndCanopies(ctx, projection, width, height)
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
  drawGoalEndCanopies(ctx, projection, width, height)
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
