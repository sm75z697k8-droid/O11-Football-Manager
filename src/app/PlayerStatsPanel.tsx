import { useState } from 'react'
import type { PlayerDefinition } from '../game/model/player'
import type { StartingAssignment } from '../game/model/team'
import {
  ATTRIBUTE_CATEGORY_LABELS, attributeProfile, categoryRows,
} from '../game/model/attribute-profile'
import type { AttributeCategory, ProfileAxis } from '../game/model/attribute-profile'
import './PlayerStatsPanel.css'

function AttributeRadar({ axes }: { readonly axes: readonly ProfileAxis[] }) {
  const cx = 160
  const cy = 160
  const radius = 93
  const polar = (index: number, r: number) => {
    const radians = index * Math.PI * 2 / axes.length - Math.PI / 2
    return { x: cx + Math.cos(radians) * r, y: cy + Math.sin(radians) * r }
  }
  const polygon = (r: number) => axes.map((_, i) => {
    const p = polar(i, r)
    return p.x.toFixed(1) + ',' + p.y.toFixed(1)
  }).join(' ')
  const profileShape = axes.map((axis, i) => {
    const p = polar(i, radius * axis.score / 20)
    return p.x.toFixed(1) + ',' + p.y.toFixed(1)
  }).join(' ')

  return (
    <section className="o11-radar">
      <div className="o11-radar-title"><strong>Attribute profile</strong><span>Derived · 1–20</span></div>
      <svg role="img" viewBox="0 0 320 328" className="o11-radar-svg"
        aria-label={'Derived attribute profile: ' + axes.map(a =>
          a.label + ' ' + a.score.toFixed(1)).join(', ')}>
        <title>Player profile calculated from O11 match-engine attribute values</title>
        {[.25, .5, .75, 1].map(level => (
          <polygon key={level} points={polygon(radius * level)} fill="none"
            stroke="rgba(155,186,210,.2)" strokeWidth="1" />
        ))}
        {axes.map((axis, i) => {
          const p = polar(i, radius)
          return <line key={axis.label} x1={cx} y1={cy} x2={p.x} y2={p.y}
            stroke="rgba(155,186,210,.2)" strokeWidth="1" />
        })}
        <polygon points={profileShape} fill="rgba(247,195,66,.19)"
          stroke="#f3c54d" strokeWidth="2.5" strokeLinejoin="round" />
        {axes.map((axis, i) => {
          const p = polar(i, radius * axis.score / 20)
          const label = polar(i, radius + 17)
          const align = label.x < cx - 24 ? 'end'
            : label.x > cx + 24 ? 'start' : 'middle'
          return (
            <g key={axis.label}>
              <circle cx={p.x} cy={p.y} r="3" fill="#ffd45e" />
              <text x={label.x} y={label.y - 1} fontSize="10" textAnchor={align}
                fill="#abbccc">{axis.label}</text>
              <text x={label.x} y={label.y + 12} fontSize="11" fontWeight="700"
                textAnchor={align} fill="#f0f4fb">{axis.score.toFixed(1)}</text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}

export default function PlayerStatsPanel({
  player, assignment, onClose,
}: {
  readonly player: PlayerDefinition
  readonly assignment: StartingAssignment
  readonly onClose: () => void
}) {
  const [tab, setTab] = useState<AttributeCategory>(
    assignment.slot === 'GK' ? 'goalkeeping' : 'technical',
  )
  const tabs: readonly AttributeCategory[] = assignment.slot === 'GK'
    ? ['goalkeeping','technical','mental','physical','setPieces']
    : ['technical','mental','physical','setPieces']
  const rows = categoryRows(player, tab, assignment.role)

  return (
    <aside className="o11-stats-panel" aria-label={'Player attributes: ' + player.profile.fullName}>
      <div className="o11-stats-head">
        <span className="o11-stats-number">{assignment.shirtNumber}</span>
        <div className="o11-stats-identity">
          <strong>{player.profile.fullName}</strong>
          <span>{assignment.slot} · {assignment.role.replace(/([A-Z])/g, ' $1')} · {assignment.duty}</span>
          <small>{player.profile.preferredFoot} foot · {player.profile.heightCm} cm · Fictional</small>
        </div>
        <button type="button" className="o11-stats-close" onClick={onClose}
          aria-label="Close player attributes">×</button>
      </div>
      <div className="o11-stats-legend">
        <span><i className="o11-stats-key" />Key for role</span>
        <span><i className="o11-stats-preferred" />Preferred</span>
      </div>
      <div className="o11-stats-tabs" role="tablist" aria-label="Attribute categories">
        {tabs.map(category => (
          <button type="button" role="tab" key={category}
            id={'o11-attribute-tab-' + category} aria-controls="o11-attribute-rows"
            aria-selected={tab === category}
            className={tab === category ? 'o11-stats-tab active' : 'o11-stats-tab'}
            onClick={() => setTab(category)}>{ATTRIBUTE_CATEGORY_LABELS[category]}</button>
        ))}
      </div>
      <div className="o11-stats-content">
        <section role="tabpanel" id="o11-attribute-rows"
          aria-labelledby={'o11-attribute-tab-' + tab} className="o11-stats-rows">
          {rows.map(row => (
            <div key={row.path} className={'o11-attribute-row' +
              (row.priority ? ' priority-' + row.priority : '')}>
              <span>{row.label}</span>
              <strong className={row.score >= 16 ? 'rating-strong' : row.score >= 11 ? 'rating-mid' : ''}>
                {row.score}
              </strong>
            </div>
          ))}
        </section>
        {tab === 'physical' && (
          <p className="o11-stats-note">
            Natural Fitness is read from the existing player characteristic.
            The engine's separate Recovery attribute is unchanged.
          </p>
        )}
        <AttributeRadar axes={attributeProfile(player)} />
        <p className="o11-stats-note">
          Display ratings are converted from the 0–100 match-engine model.
          Role highlights are scouting guidance. Radar values are derived averages,
          not separate engine ratings.
        </p>
      </div>
    </aside>
  )
}
