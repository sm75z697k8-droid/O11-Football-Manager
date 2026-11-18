import { useEffect, useRef } from 'react'
import { DEFAULT_PITCH } from '../game/model/pitch'
import { renderStadiumOnly } from '../game/viewer/renderer'
import './StadiumOnly.css'

/**
 * Temporary clean-slate home screen: empty stadium only.
 * The original match viewer and simulation remain preserved in the repo,
 * but are neither mounted nor advanced by this screen.
 */
export default function StadiumOnly({ canvasLabel = 'Empty football stadium with a marked green pitch. No players or match are active.' }: {
  readonly canvasLabel?: string
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(0, rect.width)
      const height = Math.max(0, rect.height)
      if (!width || !height) return

      // Retina-limited static buffer: sharp on iPhone without wasted memory.
      const ratio = Math.max(0.25, Math.min(
        window.devicePixelRatio || 1, 2,
        2048 / width, 1400 / height,
      ))
      const pixelWidth = Math.max(1, Math.round(width * ratio))
      const pixelHeight = Math.max(1, Math.round(height * ratio))
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
      renderStadiumOnly(ctx, DEFAULT_PITCH, width, height)
    }

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(draw) : null
    observer?.observe(canvas)
    window.addEventListener('resize', draw)
    draw()

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', draw)
    }
  }, [])

  return (
    <main className="stadium-only-screen" aria-label="Stadium preview">
      <canvas
        ref={canvasRef}
        className="stadium-only-canvas"
        role="img"
        aria-label={canvasLabel}
      />
    </main>
  )
}
