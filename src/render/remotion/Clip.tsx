// The clip: the take's frames moved by the camera path, with the cursor and
// click ripples drawn on top in output pixels, so they stay the same size at
// every zoom. The camera places the frame with fractional pixels (a CSS
// transform), so slow pans and zooms do not shake.

import type React from 'react'
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion'
import { cursorAt, type Framing, toOutput } from '../../camera/plan.ts'
import type { FrameRef, PointerStyle } from '../../types.ts'

export interface ClipProps extends Record<string, unknown> {
  width: number
  height: number
  fps: number
  durationInFrames: number
  viewport: { width: number; height: number }
  frames: FrameRef[]
  samples: Framing[]
  cursor: Array<{ t: number; type: 'cursor'; x: number; y: number }>
  pointer: Array<{ t: number; style: PointerStyle }>
  presses: Array<{ t: number; x: number; y: number }>
  cursorPx: number
  accent: string
  background: string
}

// A ring from 8 px to 36 px radius over 450 ms: a solid accent ring over a 40% accent fill, fading out.
export const RIPPLE = { seconds: 0.45, from: 8, to: 36, fill: '66', opacity: 0.9 }
const PRESS = { lead: 0.02, seconds: 0.14, squash: 0.12 }

function frameAt(frames: FrameRef[], t: number): string {
  let lo = 0
  let hi = frames.length - 1
  if (t <= frames[0].t) return frames[0].file
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return frames[lo].file
}

const easeOut = (k: number) => 1 - (1 - k) ** 3

export const Clip: React.FC<ClipProps> = (p) => {
  const frame = useCurrentFrame()
  const t = frame / p.fps
  const cam = p.samples[Math.min(frame, p.samples.length - 1)]
  const s = cam.s
  const tx = p.width / 2 - cam.cx * s
  const ty = p.height / 2 - cam.cy * s
  const out = { width: p.width, height: p.height }

  const at = cursorAt(p.cursor, t)
  let style: PointerStyle = 'arrow'
  for (const e of p.pointer) if (e.t <= t) style = e.style
  let squash = 1
  for (const press of p.presses) {
    const d = t - press.t + PRESS.lead
    if (d >= 0 && d <= PRESS.seconds) squash = 1 - PRESS.squash * Math.sin((Math.PI * d) / PRESS.seconds)
  }

  return (
    <AbsoluteFill style={{ backgroundColor: p.background, overflow: 'hidden' }}>
      <Img
        src={staticFile(frameAt(p.frames, t))}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: p.viewport.width * s,
          height: p.viewport.height * s,
          transform: `translate(${tx}px, ${ty}px)`,
          transformOrigin: '0 0',
        }}
      />
      {p.presses.map((press) => {
        const k = (t - press.t) / RIPPLE.seconds
        if (k < 0 || k > 1) return null
        const o = toOutput(press, cam, out)
        const scale = p.cursorPx / 30
        const r = (RIPPLE.from + (RIPPLE.to - RIPPLE.from) * easeOut(k)) * scale
        return (
          <div
            key={press.t}
            style={{
              position: 'absolute',
              left: o.x - r,
              top: o.y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: '50%',
              border: `${3 * scale}px solid ${p.accent}`,
              backgroundColor: `${p.accent}${RIPPLE.fill}`,
              // A thin white halo keeps the ring visible on a button in the accent colour.
              boxShadow: `0 0 0 ${1.5 * scale}px rgba(255,255,255,0.85), inset 0 0 0 ${1 * scale}px rgba(255,255,255,0.6)`,
              opacity: RIPPLE.opacity * (1 - k),
            }}
          />
        )
      })}
      {at ? <Cursor at={toOutput(at, cam, out)} size={p.cursorPx} style={style} squash={squash} /> : null}
    </AbsoluteFill>
  )
}

/** The cursor: a white arrow with a dark outline and a soft shadow, its tip on the point; an I-beam while selecting. */
const Cursor: React.FC<{ at: { x: number; y: number }; size: number; style: PointerStyle; squash: number }> = ({ at, size, style, squash }) => {
  const shadow = 'drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.35))'
  if (style === 'text') {
    const h = size * 0.9
    const w = h * 0.42
    return (
      <svg
        aria-hidden="true"
        width={w}
        height={h}
        viewBox="0 0 10 24"
        style={{ position: 'absolute', left: at.x - w / 2, top: at.y - h / 2, filter: shadow, transform: `scale(${squash})`, overflow: 'visible' }}
      >
        <path d="M1.5 1.5h7M1.5 22.5h7M5 1.5v21" stroke="#1d1b26" strokeWidth={4} strokeLinecap="round" fill="none" />
        <path d="M1.5 1.5h7M1.5 22.5h7M5 1.5v21" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" fill="none" />
      </svg>
    )
  }
  // The arrow's tip is at (3, 2) in a 20x28 box.
  const k = size / 28
  return (
    <svg
      aria-hidden="true"
      width={20 * k}
      height={28 * k}
      viewBox="0 0 20 28"
      style={{
        position: 'absolute',
        left: at.x - 3 * k,
        top: at.y - 2 * k,
        filter: shadow,
        transform: `scale(${squash})`,
        transformOrigin: `${3 * k}px ${2 * k}px`,
        overflow: 'visible',
      }}
    >
      <path d="M3 2 L3 22.5 L8.2 17.6 L11.6 25.6 L15 24.1 L11.7 16.3 L18.6 16.3 Z" fill="#fff" stroke="#1d1b26" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}
