// The camera planner: a pure function from a take log to a camera path.
// It implements the camera rules of the demo-recording playbook
// (~/projects/dotfiles/skills/demo-recording/SKILL.md, "Camera rules"):
//
// - base zoom 1.15-1.3x on the area where the action happens, never 1.0;
// - readable text at 2.0-2.5x, chosen from the font size and the display width;
// - small controls framed with their panel, capped near 1.6x;
// - stay zoomed (pan) when the next target is near, zoom further only for the key moment;
// - every move eased, one at a time, 0.7-1.0 s for a pan, 0.9-1.3 s for a zoom;
// - still from 300 ms before a press to 300 ms after it;
// - hold at least 1.5 s on a focus, 250 ms per word of text to read;
// - follow the cursor (or a tracked element) softly while zoomed;
// - pull back to the opening framing at the end.
//
// Units: a framing is a centre (cx, cy) in CSS px of the page viewport and a
// scale `s` in output px per CSS px. For the 1280x800 desktop cut, `s` is the
// playbook's zoom (1.2 = 1.2x). The phone cut (390x760) uses the same units,
// with its own ranges.

import type { Box, FocusEvent, FocusKind, Point, TakeEvent, TakeLog } from '../types.ts'

export interface Profile {
  name: string
  /** Output size in px. */
  width: number
  height: number
  /** Px the clip is shown at; defaults to the take's displayWidth. */
  displayWidth?: number
  /** Scale range of the wide framing. */
  base: [number, number]
  /** Scale range for text the viewer must read. */
  read: [number, number]
  /** Cap for controls and results that are not text to read. */
  control: number
  /** Absolute cap. */
  max: number
  /** Cursor height in output px. */
  cursorPx: number
  /** CSS px kept around a framed box. */
  pad: number
  /** Warn whenever the cursor is out of frame; otherwise only while it moves or presses (a narrow phone cut cannot show the margin). */
  cursorAlwaysVisible: boolean
}

export const DESKTOP: Profile = {
  name: 'desktop',
  width: 1280,
  height: 800,
  base: [1.15, 1.3],
  read: [2.0, 2.5],
  control: 1.6,
  max: 2.5,
  cursorPx: 30,
  pad: 24,
  cursorAlwaysVisible: true,
}

/** The phone cut: a portrait window that always fills the frame (no bars). */
export const PHONE: Profile = {
  name: 'phone',
  width: 390,
  height: 760,
  displayWidth: 390,
  base: [0.95, 1.0],
  read: [1.05, 1.5],
  control: 1.2,
  max: 1.6,
  cursorPx: 22,
  pad: 12,
  cursorAlwaysVisible: false,
}

export const PROFILES: Record<string, Profile> = { desktop: DESKTOP, phone: PHONE }

export const RULES = {
  /** Text the clip relies on is at least this tall where it is shown. */
  minReadablePx: 14,
  /** Pan duration range in seconds (by distance). */
  pan: [0.7, 1.0] as [number, number],
  /** Zoom-change duration range in seconds (by zoom ratio). */
  zoom: [0.9, 1.3] as [number, number],
  /** The shortest move the planner makes when it has to squeeze one in. */
  minMove: 0.5,
  /** Still before a press. */
  settle: 0.3,
  /** Still after a press. */
  after: 0.3,
  /** Minimum hold on any focus. */
  minHold: 1.5,
  /** Minimum hold on an action (a control about to be pressed): it is the press that matters. */
  actionHold: 1.0,
  /** Hold per word of text to read. */
  perWord: 0.25,
  /** Hold on the opening framing. */
  openingHold: 1.0,
  /** Hold on the closing framing (the loop seam). */
  endHold: 1.0,
  /** The follow dead zone: the middle 60% of the window. */
  deadzone: 0.6,
  /** A follow pan shorter than this (output px) is a distracting nudge, so it is skipped. */
  minFollowPx: 30,
  /** The camera follows the cursor this many seconds behind. */
  lag: 0.15,
  /** Emphasis zooms to the top of the reading range, and at least this much further than the current framing. */
  emphasis: 1.25,
  /** A move into an action may start this long before its focus is logged, to settle before the press. */
  anticipate: 1.2,
  /** After an emphasised press: this long, then back to the reading zoom. */
  release: 0.6,
}

export interface Framing {
  cx: number
  cy: number
  s: number
}

export interface Move {
  start: number
  end: number
  from: Framing
  to: Framing
  reason: string
}

export interface CameraPlan {
  profile: string
  fps: number
  duration: number
  viewport: { width: number; height: number }
  opening: Framing
  moves: Move[]
  /** One framing per output frame. */
  samples: Framing[]
  warnings: string[]
}

type Viewport = { width: number; height: number }
type PressEvent = Extract<TakeEvent, { type: 'press' }>
type TrackEvent = Extract<TakeEvent, { type: 'track' }>
type CursorEvent = Extract<TakeEvent, { type: 'cursor' }>
type LayoutEvent = Extract<TakeEvent, { type: 'layout' }>

interface Shot {
  t: number
  name: string
  kind: FocusKind | 'release' | 'end'
  framing: Framing
  hold: number
  /** What the shot is about; follow pans keep it in view when it fits. */
  box?: Box
}

const EPS = 1e-6
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Smootherstep: zero velocity and acceleration at both ends. */
export function ease(k: number): number {
  const x = clamp(k, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** The smallest scale at which the window still fits inside the viewport (no bars). */
export function fillScale(p: Profile, vp: Viewport): number {
  return Math.max(p.width / vp.width, p.height / vp.height)
}

/** The window a framing shows, in CSS px. */
export function windowOf(f: Framing, p: Profile): Box {
  const w = p.width / f.s
  const h = p.height / f.s
  return { x: f.cx - w / 2, y: f.cy - h / 2, w, h }
}

/** Keeps the window inside the viewport and the scale at or above the fill scale. */
export function clampFraming(f: Framing, p: Profile, vp: Viewport): Framing {
  const s = Math.max(f.s, fillScale(p, vp))
  const w = p.width / s
  const h = p.height / s
  return { cx: clamp(f.cx, w / 2, vp.width - w / 2), cy: clamp(f.cy, h / 2, vp.height - h / 2), s }
}

/** The largest scale at which the padded box fits the output. */
export function fitScale(box: Box, p: Profile): number {
  return Math.min(p.width / (box.w + 2 * p.pad), p.height / (box.h + 2 * p.pad))
}

/**
 * The zoom that makes text readable where the clip is shown: the text is at
 * least 14 px tall on the display, clamped to the profile's reading range.
 */
export function readScale(fontPx: number, p: Profile, displayWidth: number): number {
  const need = (RULES.minReadablePx * p.width) / (fontPx * displayWidth)
  return clamp(need, p.read[0], Math.min(p.read[1], p.max))
}

/**
 * The zoom for a block of text to read: readable (`readScale`), but when the
 * whole width of the block fits at a smaller zoom that is still readable, that
 * one, so no line is cut at the frame's edge.
 */
export function readScaleFor(box: Box, fontPx: number, p: Profile, displayWidth: number): number {
  const s = readScale(fontPx, p, displayWidth)
  const need = (RULES.minReadablePx * p.width) / (fontPx * displayWidth)
  const fitWidth = p.width / (box.w + 2 * p.pad)
  return fitWidth < s && fitWidth >= need ? Math.max(fitWidth, p.base[1]) : s
}

/**
 * Frames a box at scale `s`: centred when it fits. When it does not, text to
 * read is anchored at its start (top-left, where reading begins) and anything
 * else is centred across and anchored at the top.
 */
export function frameBox(box: Box, s: number, p: Profile, vp: Viewport, anchor: 'start' | 'center' = 'center'): Framing {
  const w = p.width / s
  const h = p.height / s
  const cx = box.w + 2 * p.pad <= w || anchor === 'center' ? box.x + box.w / 2 : box.x - p.pad + w / 2
  const cy = box.h + 2 * p.pad <= h ? box.y + box.h / 2 : box.y - p.pad + h / 2
  return clampFraming({ cx, cy, s }, p, vp)
}

/** Seconds for a move, by pan distance (in output px) and zoom ratio. */
export function moveDuration(a: Framing, b: Framing, p: Profile): number {
  const zoomChange = Math.abs(Math.log(b.s / a.s))
  const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy) * Math.max(a.s, b.s)
  const pan = dist < 1 ? 0 : lerp(RULES.pan[0], RULES.pan[1], clamp(dist / (p.width * 0.6), 0, 1))
  if (zoomChange < 0.02) return pan
  const zoom = lerp(RULES.zoom[0], RULES.zoom[1], clamp(zoomChange / Math.log(2.2), 0, 1))
  return Math.max(zoom, pan)
}

/** Whether a point is in the middle part (the dead zone) of a framing's window. */
export function inDeadzone(pt: Point, f: Framing, p: Profile, zone = RULES.deadzone): boolean {
  const w = windowOf(f, p)
  return Math.abs(pt.x - f.cx) <= (w.w * zone) / 2 && Math.abs(pt.y - f.cy) <= (w.h * zone) / 2
}

const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** The framing of a move at time t. */
export function interpolate(m: Move, t: number): Framing {
  const k = m.end - m.start <= EPS ? 1 : ease((t - m.start) / (m.end - m.start))
  return {
    cx: lerp(m.from.cx, m.to.cx, k),
    cy: lerp(m.from.cy, m.to.cy, k),
    s: Math.exp(lerp(Math.log(m.from.s), Math.log(m.to.s), k)),
  }
}

/** The framing at time t along a sorted, non-overlapping list of moves. */
export function framingAt(moves: Move[], opening: Framing, t: number): Framing {
  let cam = opening
  for (const m of moves) {
    if (t < m.start) return cam
    if (t < m.end) return interpolate(m, t)
    cam = m.to
  }
  return cam
}

/** Cursor position at time t, linearly between logged samples. */
export function cursorAt(cursor: CursorEvent[], t: number): Point | null {
  if (!cursor.length) return null
  if (t <= cursor[0].t) return { x: cursor[0].x, y: cursor[0].y }
  let lo = 0
  let hi = cursor.length - 1
  if (t >= cursor[hi].t) return { x: cursor[hi].x, y: cursor[hi].y }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cursor[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = cursor[lo]
  const b = cursor[hi]
  const k = (t - a.t) / (b.t - a.t || 1)
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }
}

/**
 * Edge snapping: nudges a framing up or down (at most 15% of the window
 * height) so the top and bottom edges fall between text lines, not through
 * them, and no line shows only a sliver at a side edge, while the subject box
 * stays in view. Bigger text cut costs more.
 */
export function snapEdges(f: Framing, lines: Box[], box: Box | undefined, p: Profile, vp: Viewport): Framing {
  if (!lines.length) return f
  const w = windowOf(f, p)
  const reach = w.h * 0.15
  const lo = Math.max(w.h / 2, box && box.h + 2 * p.pad <= w.h ? box.y + box.h + p.pad - w.h / 2 : Number.NEGATIVE_INFINITY)
  const hi = Math.min(vp.height - w.h / 2, box && box.h + 2 * p.pad <= w.h ? box.y - p.pad + w.h / 2 : Number.POSITIVE_INFINITY)
  const visible = lines.filter((l) => l.x + l.w > w.x && l.x < w.x + w.w)
  // A line the side edges reduce to a sliver (a stray letter in a corner) counts as cut too.
  const sliver = (l: Box) => Math.min(l.x + l.w, w.x + w.w) - Math.max(l.x, w.x) < Math.min(48, l.w * 0.5)
  const cost = (cy: number) => {
    const top = cy - w.h / 2
    const bottom = cy + w.h / 2
    let c = 0
    for (const l of visible) {
      if (l.y < top && l.y + l.h > top) c += l.h
      if (l.y < bottom && l.y + l.h > bottom) c += l.h
      if (sliver(l) && l.y + l.h > top && l.y < bottom) c += l.h
    }
    return c
  }
  let best = f.cy
  let bestCost = cost(f.cy) + 1e-9
  if (bestCost < 1e-6) return f
  for (let d = 1; d <= reach; d++) {
    for (const cy of [f.cy - d, f.cy + d]) {
      if (cy < lo - EPS || cy > hi + EPS) continue
      const c = cost(cy) + d * 0.01
      if (c < bestCost) {
        bestCost = c
        best = cy
      }
    }
  }
  return { ...f, cy: best }
}

/** The text lines of the latest layout at or before t. */
function layoutAt(layouts: LayoutEvent[], t: number): Box[] {
  let lines: Box[] = []
  for (const e of layouts) {
    if (e.t > t + EPS) break
    lines = e.lines
  }
  return lines
}

/** Moves a framing the least needed to keep a box (the shot's subject) fully in view, when the box fits. */
function keepInView(f: Framing, box: Box | undefined, p: Profile): Framing {
  if (!box) return f
  const w = windowOf(f, p)
  const fit = (lo: number, size: number, win: number, c: number) =>
    size + 2 * p.pad > win + 0.5 ? c : clamp(c, lo + size + p.pad - win / 2, lo - p.pad + win / 2)
  return { ...f, cx: fit(box.x, box.w, w.w, f.cx), cy: fit(box.y, box.h, w.h, f.cy) }
}

/** The cursor at time t if it is gliding: it moved within the last 0.3 s (a lone sample is not a move). */
function movingCursorAt(cursor: CursorEvent[], t: number): Point | null {
  let i = -1
  for (let k = 0; k < cursor.length && cursor[k].t <= t; k++) i = k
  if (i < 1 || t - cursor[i].t > 0.3) return null
  const a = cursor[i - 1]
  const b = cursor[i]
  return b.t - a.t <= 0.1 && (a.x !== b.x || a.y !== b.y) ? cursorAt(cursor, t) : null
}

/** The latest tracked box at time t, if a track is live (a sample within the last 0.4 s). */
function trackAt(tracks: TrackEvent[], t: number): Point | null {
  let last: TrackEvent | null = null
  for (const e of tracks) {
    if (e.t > t) break
    last = e
  }
  return last && t - last.t <= 0.4 ? center(last.box) : null
}

/** Plans the camera for one output profile. */
export function planCamera(log: TakeLog, profile: Profile, opts: { fps?: number } = {}): CameraPlan {
  const fps = opts.fps ?? 30
  const vp = log.viewport
  const p = profile
  const display = p.displayWidth ?? log.displayWidth
  const T = log.duration
  const warnings: string[] = []
  const events = [...log.events].sort((a, b) => a.t - b.t)
  const presses = events.filter((e): e is PressEvent => e.type === 'press')
  const focuses = events.filter((e): e is FocusEvent => e.type === 'focus')
  const tracks = events.filter((e): e is TrackEvent => e.type === 'track')
  const cursor = events.filter((e): e is CursorEvent => e.type === 'cursor')
  // The camera follows the cursor only while it moves, and never a glide out of the way.
  const moving = cursor.filter((e) => !e.rest)
  const endEvent = events.find((e) => e.type === 'end')
  const layouts = events.filter((e): e is LayoutEvent => e.type === 'layout')

  const fill = fillScale(p, vp)
  const baseLo = Math.max(p.base[0], fill)
  const baseHi = Math.max(p.base[1], baseLo)
  const contextFraming = (box: Box) => frameBox(box, clamp(fitScale(box, p), baseLo, baseHi), p, vp)

  // --- The opening: the first context focus, or the middle of the page. ---
  const firstContext = focuses.find((f) => f.kind === 'context')
  const opening = snapEdges(
    firstContext ? contextFraming(firstContext.box) : clampFraming({ cx: vp.width / 2, cy: vp.height / 2, s: baseLo }, p, vp),
    layoutAt(layouts, firstContext?.t ?? 0),
    firstContext?.box,
    p,
    vp,
  )

  // --- Shots: where each focus wants the camera, and for how long. ---
  const shots: Shot[] = []
  let prev = opening
  let steady = opening
  let reading = 0
  for (let i = 0; i < focuses.length; i++) {
    const f = focuses[i]
    let s: number
    if (f.kind === 'context') {
      s = clamp(fitScale(f.box, p), baseLo, baseHi)
    } else if (f.kind === 'read' || (f.kind === 'result' && f.words)) {
      s = readScaleFor(f.box, f.fontPx ?? 16, p, display)
    } else {
      s = clamp(fitScale(f.box, p), baseLo, Math.max(p.control, baseLo))
      // Stay zoomed: a target near the current (non-emphasis) framing is panned to at the reading zoom, not pulled back from.
      const w = windowOf(steady, p)
      const c = center(f.box)
      const near = Math.abs(c.x - steady.cx) <= w.w && Math.abs(c.y - steady.cy) <= w.h
      if (reading > s && near) s = reading
    }
    // The key moment goes to the top of the reading range (2.5x on desktop), at least a clear step past the current zoom.
    if (f.emphasis) s = Math.min(p.max, Math.max(p.read[1], Math.max(s, prev.s, reading) * RULES.emphasis))
    const isText = f.kind === 'read' || (f.kind === 'result' && !!f.words)
    const framing = snapEdges(frameBox(f.box, s, p, vp, isText ? 'start' : 'center'), layoutAt(layouts, f.t), f.box, p, vp)
    // An explicit hold replaces the per-word hold; neither goes under the minimum.
    const words = f.words && (f.kind === 'read' || f.kind === 'result') ? f.words * RULES.perWord : 0
    const min = f.kind === 'action' ? RULES.actionHold : RULES.minHold
    shots.push({ t: f.t, name: f.name, kind: f.kind, framing, hold: Math.max(min, f.hold ?? words), box: f.box })
    if (f.kind === 'read' || (f.kind === 'result' && f.words)) reading = s
    else if (f.kind === 'context') reading = 0
    prev = framing
    if (!f.emphasis) steady = framing

    // After an emphasised press, settle back to the reading zoom.
    if (f.emphasis) {
      const next = focuses[i + 1]
      const press = presses.find((e) => e.t >= f.t - EPS && (!next || e.t < next.t))
      const back = reading || Math.max(baseHi, s / RULES.emphasis)
      if (press) {
        const t = press.t + RULES.after + RULES.release
        const framingBack = snapEdges(frameBox(f.box, back, p, vp), layoutAt(layouts, f.t), f.box, p, vp)
        if (!next || next.t > t + 0.5) {
          shots.push({ t, name: `${f.name} (release)`, kind: 'release', framing: framingBack, hold: 0 })
          prev = framingBack
        }
      }
    }
  }
  if (endEvent) {
    shots.push({ t: endEvent.t, name: 'pull back', kind: 'end', framing: opening, hold: RULES.endHold })
  } else {
    warnings.push('no end event: the pull-back was placed at the end of the take')
    const dur = moveDuration(prev, opening, p)
    shots.push({ t: Math.max(0, T - RULES.endHold - dur), name: 'pull back', kind: 'end', framing: opening, hold: RULES.endHold })
  }

  // --- Schedule the shot moves around holds and presses. ---
  const shotMoves: Move[] = []
  const shotBoxes: Array<Box | undefined> = []
  let cam = opening
  let holdUntil = RULES.openingHold
  let holdName = 'opening'
  let arrived = 0
  let lastEnd = 0
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    let dur = moveDuration(cam, shot.framing, p)
    if (dur === 0) {
      holdUntil = Math.max(holdUntil, shot.t + shot.hold)
      continue
    }
    const nextT = shots[i + 1]?.t ?? Number.POSITIVE_INFINITY
    const own = presses.find((e) => e.t >= shot.t - EPS && e.t < nextT)
    // Never before the previous move ends; a press may cut the previous hold short, nothing else may.
    const floor = Math.max(lastEnd, own ? shot.t - RULES.anticipate : shot.t, 0)
    const earliest = own ? floor : Math.max(floor, holdUntil)
    let start = Math.max(shot.t, holdUntil, lastEnd)
    if (own && start + dur > own.t - RULES.settle + EPS) start = Math.max(floor, own.t - RULES.settle - dur)
    if (start - shot.t > 0.6) {
      warnings.push(
        `${shot.name}: the camera starts ${(start - shot.t).toFixed(2)}s after the focus, held by ${holdName}; add a wait before it in the storyboard`,
      )
    }
    // Fit the move around presses: arrive before this shot's press, wait for earlier ones.
    for (let guard = 0; guard < presses.length + 2; guard++) {
      const c = presses.find((e) => start < e.t + RULES.after - EPS && start + dur > e.t - RULES.settle + EPS)
      if (!c) break
      if (own && c.t >= own.t - EPS) {
        const latestEnd = c.t - RULES.settle
        if (latestEnd - dur >= earliest - EPS) start = latestEnd - dur
        else if (latestEnd - earliest >= RULES.minMove - EPS) {
          start = earliest
          dur = latestEnd - earliest
        } else {
          warnings.push(`${shot.name}: no time to settle before the press at ${c.t.toFixed(2)}s; the move waits until after it`)
          start = c.t + RULES.after
        }
      } else {
        start = c.t + RULES.after
      }
    }
    if (start < holdUntil - EPS) {
      const min = holdUntil - arrived
      warnings.push(`${holdName}: held ${(start - arrived).toFixed(2)}s, less than its ${min.toFixed(2)}s minimum, to settle before a press`)
    }
    if (shot.kind === 'end') {
      const latestEnd = T - RULES.endHold
      if (start + dur > latestEnd + EPS) {
        start = Math.max(earliest, latestEnd - dur)
        if (start + dur > latestEnd + EPS) {
          dur = Math.max(RULES.minMove, latestEnd - start)
          if (start + dur > latestEnd + EPS) warnings.push('the take ends too soon for the pull-back and its hold; record longer after end()')
        }
      }
    }
    if (shot.kind === 'release') {
      const next = shots[i + 1]
      if (next && next.t < start + dur + 0.3) continue
    }
    shotMoves.push({ start, end: start + dur, from: cam, to: shot.framing, reason: `${shot.kind}: ${shot.name}` })
    shotBoxes.push(shot.kind === 'release' ? shotBoxes[shotBoxes.length - 1] : shot.box)
    cam = shot.framing
    lastEnd = start + dur
    arrived = lastEnd
    holdUntil = lastEnd + shot.hold
    holdName = shot.name
  }

  // --- Follow pans and press pre-pans, between the shot moves. ---
  const moves: Move[] = []
  const step = 1 / fps
  cam = opening
  let busyUntil = 0
  let next = 0
  let focusBox: Box | undefined
  const freezeStart = (t: number) => {
    const p2 = presses.find((e) => e.t - RULES.settle > t + EPS)
    return p2 ? p2.t - RULES.settle : Number.POSITIVE_INFINITY
  }
  const frozen = (t: number) => presses.some((e) => t > e.t - RULES.settle - EPS && t < e.t + RULES.after - EPS)
  for (let f = 0; f * step <= T + EPS; f++) {
    const t = f * step
    while (next < shotMoves.length && shotMoves[next].start <= t + EPS) {
      const m = { ...shotMoves[next++] }
      if (m.start < busyUntil - EPS) {
        // A follow pan is still going: the shot move takes over from where it is.
        const last = moves[moves.length - 1]
        last.to = interpolate(last, m.start)
        last.end = m.start
      }
      m.from = framingAt(moves, opening, m.start)
      focusBox = shotBoxes[next - 1]
      moves.push(m)
      cam = m.to
      busyUntil = m.end
    }
    if (t < busyUntil - EPS || frozen(t)) continue
    const limit = Math.min(next < shotMoves.length ? shotMoves[next].start : T - RULES.endHold, freezeStart(t))
    // Follow while zoomed in, or whenever the window shows only part of the page width (the phone cut).
    const zoomed = cam.s > baseHi + 0.05 || p.width / cam.s < 0.75 * vp.width

    // Press pre-pan: the press point must be in the dead zone before the camera settles.
    const press = presses.find((e) => e.t - RULES.settle > t + EPS)
    const shotBefore = next < shotMoves.length && press && shotMoves[next].start < press.t
    if (press && !shotBefore && !inDeadzone(press, cam, p)) {
      const target = clampFraming({ cx: press.x, cy: press.y, s: cam.s }, p, vp)
      const need = moveDuration(cam, target, p)
      const until = press.t - RULES.settle
      if (until - t <= need + EPS) {
        const dur = until - t
        if (dur >= RULES.minMove - EPS) {
          moves.push({ start: t, end: until, from: cam, to: target, reason: 'press: bring the press point into view' })
          cam = target
          busyUntil = until
        } else if (!inDeadzone(press, cam, p, 1)) {
          warnings.push(`the press at ${press.t.toFixed(2)}s is outside the frame and there is no time to pan to it`)
        }
        continue
      }
    }

    // Follow the subject (a tracked element, else the cursor) while zoomed.
    if (!zoomed) continue
    const subjectAt = (u: number) => trackAt(tracks, u) ?? movingCursorAt(moving, u)
    const subject = subjectAt(t - RULES.lag)
    if (!subject || inDeadzone(subject, cam, p)) continue
    // The plan is made after the take, so the pan aims where the subject will be when it ends.
    // A follow pan gets its natural duration, or is skipped; it is squeezed only when the subject is leaving the frame.
    const first = moveDuration(cam, clampFraming({ cx: subject.x, cy: subject.y, s: cam.s }, p, vp), p)
    const leaving = !inDeadzone(subject, cam, p, 0.9)
    const dur = Math.min(first, limit - t)
    if (dur < first - EPS && !leaving) continue
    if (dur < RULES.minMove - EPS) continue
    // Recentre only along the axis where the subject left the dead zone, keep the shot's box in view, and skip nudges.
    const ahead = subjectAt(t + dur - RULES.lag) ?? subject
    const win = windowOf(cam, p)
    const outX = Math.abs(subject.x - cam.cx) > (win.w * RULES.deadzone) / 2
    const outY = Math.abs(subject.y - cam.cy) > (win.h * RULES.deadzone) / 2
    const target = keepInView(clampFraming({ cx: outX ? ahead.x : cam.cx, cy: outY ? ahead.y : cam.cy, s: cam.s }, p, vp), focusBox, p)
    if (Math.hypot(target.cx - cam.cx, target.cy - cam.cy) * cam.s < RULES.minFollowPx) continue
    moves.push({ start: t, end: t + dur, from: cam, to: target, reason: 'follow' })
    cam = target
    busyUntil = t + dur
  }

  const samples: Framing[] = []
  const frames = Math.max(1, Math.round(T * fps))
  for (let f = 0; f < frames; f++) samples.push(clampFraming(framingAt(moves, opening, f / fps), p, vp))

  // The cursor must be visible the whole time: report each stretch it spends out of frame.
  let outFrom = -1
  const report = (to: number) => {
    if (outFrom >= 0 && to - outFrom >= 0.3)
      warnings.push(`the cursor is out of frame from ${outFrom.toFixed(2)}s to ${to.toFixed(2)}s; rest it inside the shot`)
    outFrom = -1
  }
  const acting = (t: number) => !!movingCursorAt(moving, t) || presses.some((e) => Math.abs(e.t - t) <= 0.5)
  for (let f = 0; f < frames; f++) {
    const t = f / fps
    const c = cursorAt(cursor, t)
    if (!c) continue
    if (!p.cursorAlwaysVisible && !acting(t)) {
      report(t)
      continue
    }
    const w = windowOf(samples[f], p)
    const inside = c.x >= w.x && c.x <= w.x + w.w - 8 && c.y >= w.y && c.y <= w.y + w.h - 12
    if (!inside && outFrom < 0) outFrom = t
    if (inside) report(t)
  }
  report(frames / fps)
  return { profile: p.name, fps, duration: T, viewport: vp, opening, moves, samples, warnings }
}

/** The camera at time t, from a plan's samples. */
export function cameraAt(plan: CameraPlan, t: number): Framing {
  const i = clamp(Math.round(t * plan.fps), 0, plan.samples.length - 1)
  return plan.samples[i]
}

/** Maps a page point (CSS px) to output px under a framing. */
export function toOutput(pt: Point, f: Framing, p: Pick<Profile, 'width' | 'height'>): Point {
  return { x: (pt.x - f.cx) * f.s + p.width / 2, y: (pt.y - f.cy) * f.s + p.height / 2 }
}
