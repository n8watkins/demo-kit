// The take log (take.json): what the recorder saw and did, on one clock.
// All times are seconds into the take, after cut stretches are removed.
// All positions are CSS pixels in the page's viewport.

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * What a focus target is, which decides how the camera frames it:
 * - `read`: text the viewer must read (zoomed until it is readable),
 * - `action`: a control about to be used (framed with its panel, capped),
 * - `result`: what appeared after an action,
 * - `context`: a whole panel or page (the wide framing).
 */
export type FocusKind = 'read' | 'action' | 'result' | 'context'

export interface FocusEvent {
  t: number
  type: 'focus'
  name: string
  kind: FocusKind
  box: Box
  /** Font size in CSS px of the text in the box, for the readability zoom. */
  fontPx?: number
  /** Words to read in the box: the hold is about 250 ms per word. */
  words?: number
  /** Minimum hold in seconds, when it should differ from the rules. */
  hold?: number
  /** The key moment: zoom a step further than the current framing. */
  emphasis?: boolean
}

export type TakeEvent =
  /** A cursor sample; `rest` marks a glide out of the way, which the camera never follows. */
  | { t: number; type: 'cursor'; x: number; y: number; rest?: boolean }
  | { t: number; type: 'down' | 'up'; x: number; y: number }
  | { t: number; type: 'press'; x: number; y: number; name?: string }
  | { t: number; type: 'pointer'; style: PointerStyle }
  | FocusEvent
  | { t: number; type: 'track'; name: string; box: Box }
  /** The visible text lines at this moment, so the camera can avoid cutting a line at its top or bottom edge. */
  | { t: number; type: 'layout'; lines: Box[] }
  | { t: number; type: 'hold'; seconds: number; reason?: string }
  | { t: number; type: 'poster' }
  | { t: number; type: 'end' }

export type PointerStyle = 'arrow' | 'text'

export interface FrameRef {
  t: number
  file: string
}

export interface PreflightCheck {
  name: string
  ok: boolean
  detail: string
}

export interface BuildReport {
  /** `false` when the take was recorded with --skip-preflight. */
  checked: boolean
  extension?: string
  repo?: string
  ref?: string
  sha?: string
  name?: string
  version?: string
  checks: PreflightCheck[]
}

export interface TakeLog {
  version: 1
  storyboard: string
  title: string
  recordedAt: string
  viewport: { width: number; height: number }
  /** Source pixels per CSS pixel (the device scale factor). */
  scale: number
  /** Seconds. */
  duration: number
  /** Where the desktop cut is shown, in px (a homepage card, a store listing). */
  displayWidth: number
  accent: string
  frames: FrameRef[]
  events: TakeEvent[]
  build?: BuildReport
}
