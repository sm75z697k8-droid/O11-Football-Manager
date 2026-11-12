import type { MatchSetup } from '../model/match'
import type { MatchState } from '../match/state'
import type { Point2 } from '../model/pitch'
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

const FIELD_LINE = 'rgba(219,247,222,0.49)'

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

function drawPitch(
  ctx: CanvasRenderingContext2D, projection: PitchProjection,
  length: number, width: number,
): void {
  const { x, y, height, scale } = projection
  ctx.fillStyle = '#122b24'
  ctx.fillRect(x - 3, y - 3, projection.width + 6, projection.height + 6)
  ctx.fillStyle = '#193f30'
  ctx.fillRect(x, y, projection.width, height)
  const stripes = 12
  for (let i = 0; i < stripes; i += 1) {
    if (i % 2 === 1) {
      ctx.fillStyle = '#1d4836'
      ctx.fillRect(x + (i / stripes) * length * scale, y,
        (length / stripes) * scale, height)
    }
  }
  drawMarkings(ctx, projection, length, width)
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
  ctx.fillStyle = '#0c1a1a'
  ctx.fillRect(0, 0, width, height)

  const projection = projectPitch(width, height, setup.pitch)
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

    ctx.fillStyle = teamColors.get(player.clubId) ?? '#b7bfc1'
    ctx.strokeStyle = player.formationSlot === 'GK' ? '#eaffdd' : 'rgba(255,255,255,.58)'
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
