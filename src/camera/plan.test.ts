import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Box, FocusEvent, TakeEvent, TakeLog } from '../types.ts'
import {
  type CameraPlan,
  DESKTOP,
  type Framing,
  inDeadzone,
  PHONE,
  type Profile,
  planCamera,
  RULES,
  readScale,
  readScaleFor,
  snapEdges,
  toOutput,
  windowOf,
} from './plan.ts'

const VIEWPORT = { width: 1280, height: 800 }
const ARTICLE: Box = { x: 300, y: 60, w: 680, h: 740 }
const PARAGRAPH: Box = { x: 300, y: 360, w: 680, h: 90 }
const PLAY: Box = { x: 640, y: 470, w: 28, h: 28 }

function log(events: TakeEvent[], duration: number, extra: Partial<TakeLog> = {}): TakeLog {
  return {
    version: 1,
    storyboard: 'test',
    title: 'test',
    recordedAt: '2026-11-09T00:00:00Z',
    viewport: VIEWPORT,
    scale: 2,
    duration,
    displayWidth: 640,
    accent: '#4f46e5',
    frames: [],
    events,
    ...extra,
  }
}

const focus = (t: number, kind: FocusEvent['kind'], box: Box, more: Partial<FocusEvent> = {}): FocusEvent => ({
  t,
  type: 'focus',
  name: `${kind}@${t}`,
  kind,
  box,
  ...more,
})

/** Cursor samples gliding from a to b between t0 and t1. */
function glide(t0: number, t1: number, a: { x: number; y: number }, b: { x: number; y: number }): TakeEvent[] {
  const out: TakeEvent[] = []
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) {
    const k = (t - t0) / (t1 - t0)
    out.push({ t, type: 'cursor', x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
  }
  return out
}

const press = (t: number, b: Box): TakeEvent => ({ t, type: 'press', x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** The test-page story in miniature: context, read, press play (emphasis), result, pull back. */
function story(): TakeLog {
  const playAt = { x: PLAY.x + 14, y: PLAY.y + 14 }
  return log(
    [
      { t: 0, type: 'cursor', x: 1100, y: 300 },
      focus(0, 'context', ARTICLE),
      focus(1.5, 'read', PARAGRAPH, { fontPx: 18, words: 14 }),
      ...glide(1.5, 3.5, { x: 302, y: 368 }, { x: 900, y: 440 }),
      focus(6, 'action', PLAY, { emphasis: true }),
      ...glide(6, 6.9, { x: 900, y: 440 }, playAt),
      press(7.1, PLAY),
      focus(9, 'result', { x: 400, y: 700, w: 480, h: 64 }),
      focus(11, 'read', PARAGRAPH, { fontPx: 18 }),
      { t: 13, type: 'end' },
    ],
    16,
  )
}

/** The reading zoom of PARAGRAPH's 18 px text on a 640 px card: whole lines, 1.76x. */
const READING = 1280 / (680 + 2 * DESKTOP.pad)

const sampleTimes = (plan: CameraPlan) => plan.samples.map((_, i) => i / plan.fps)
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps
const same = (a: Framing, b: Framing, eps = 1e-6) => near(a.cx, b.cx, eps) && near(a.cy, b.cy, eps) && near(a.s, b.s, eps)

describe('zoom levels', () => {
  it('opens at a base zoom of 1.15-1.3x on the context area, never 1.0', () => {
    const plan = planCamera(story(), DESKTOP)
    assert.ok(plan.opening.s >= 1.15 && plan.opening.s <= 1.3, `opening ${plan.opening.s}`)
    for (const f of plan.samples) assert.ok(f.s >= 1.15 - 1e-9, `sample below base: ${f.s}`)
  })

  it('chooses the reading zoom from the text size and display width (2.0-2.5x)', () => {
    assert.equal(readScale(16, DESKTOP, 640), 2.0) // 1.75 needed, raised to the 2.0 floor
    assert.ok(near(readScale(13, DESKTOP, 640), (14 * 1280) / (13 * 640)))
    assert.equal(readScale(9, DESKTOP, 640), 2.5) // capped
    assert.equal(readScale(18, DESKTOP, 1280), 2.0)
  })

  it('zooms to readable text on a read focus', () => {
    const plan = planCamera(log([focus(0, 'context', ARTICLE), focus(1.2, 'read', PARAGRAPH, { fontPx: 14 }), { t: 5, type: 'end' }], 9), DESKTOP)
    const s = plan.samples[Math.round(4 * plan.fps)].s
    assert.ok(near(s, readScale(14, DESKTOP, 640)), `reading zoom ${s}`)
    // Text is at least 14 px tall on the display.
    assert.ok(14 * s * (640 / 1280) >= RULES.minReadablePx - 1e-9)
  })

  it('keeps whole lines when a smaller zoom still reads at 14 px', () => {
    // 680 px of 18 px text on a 640 px card: 1.56x is readable and 1.76x shows whole lines, so not 2.0x.
    const s = readScaleFor(PARAGRAPH, 18, DESKTOP, 640)
    assert.ok(near(s, 1280 / (680 + 2 * DESKTOP.pad)), `zoom ${s}`)
    assert.ok(18 * s * (640 / 1280) >= RULES.minReadablePx)
    // 13 px text needs 2.15x, so lines are cut and the camera follows instead.
    assert.ok(near(readScaleFor(PARAGRAPH, 13, DESKTOP, 640), readScale(13, DESKTOP, 640)))
  })

  it('caps a small control near 1.6x instead of filling the frame with it', () => {
    const tiny: Box = { x: 1180, y: 20, w: 24, h: 24 }
    const plan = planCamera(log([focus(0, 'context', ARTICLE), focus(1.2, 'action', tiny), press(3.5, tiny), { t: 5, type: 'end' }], 9), DESKTOP)
    for (const f of plan.samples) assert.ok(f.s <= DESKTOP.control + 1e-9, `control zoom ${f.s}`)
  })

  it('zooms one step further for an emphasised press, then settles back to the reading zoom', () => {
    const plan = planCamera(story(), DESKTOP)
    const at = (t: number) => plan.samples[Math.round(t * plan.fps)]
    assert.ok(near(at(7.1).s, DESKTOP.read[1]), `press zoom ${at(7.1).s}`)
    assert.ok(near(at(10.5).s, READING), `back to reading ${at(10.5).s}`)
    for (const f of plan.samples) assert.ok(f.s <= DESKTOP.max + 1e-9)
  })
})

describe('release', () => {
  it('settles back to the reading zoom after an emphasised press when nothing else follows', () => {
    const plan = planCamera(
      log(
        [
          focus(0, 'context', ARTICLE),
          focus(1.2, 'read', PARAGRAPH, { fontPx: 18 }),
          focus(4, 'action', PLAY, { emphasis: true }),
          press(5, PLAY),
          { t: 9, type: 'end' },
        ],
        12,
      ),
      DESKTOP,
    )
    assert.ok(
      plan.moves.some((m) => m.reason.includes('(release)')),
      'no release move',
    )
    assert.ok(near(plan.samples[Math.round(8.5 * plan.fps)].s, READING))
  })
})

describe('movement', () => {
  it('stays zoomed and pans to a near target instead of pulling back', () => {
    const below: Box = { x: 600, y: 470, w: 120, h: 40 }
    const plan = planCamera(
      log([focus(0, 'context', ARTICLE), focus(1.2, 'read', PARAGRAPH, { fontPx: 18 }), focus(4, 'action', below), press(6, below), { t: 8, type: 'end' }], 12),
      DESKTOP,
    )
    const between = plan.samples.slice(Math.round(2.7 * plan.fps), Math.round(6.4 * plan.fps))
    for (const f of between) assert.ok(near(f.s, READING, 1e-6), `pulled back to ${f.s}`)
  })

  it('eases every move: still at both ends, no jump between frames', () => {
    const plan = planCamera(story(), DESKTOP)
    for (const m of plan.moves) {
      const d = m.end - m.start
      assert.ok(d >= RULES.minMove - 1e-9, `${m.reason}: ${d}s is too abrupt`)
      assert.ok(d <= RULES.zoom[1] + 1e-9, `${m.reason}: ${d}s is too slow`)
    }
    // The largest per-frame step in output px stays small (a 1-second move across the frame is ~40 px/frame at its peak).
    for (let i = 1; i < plan.samples.length; i++) {
      const a = plan.samples[i - 1]
      const b = plan.samples[i]
      const step = Math.hypot((b.cx - a.cx) * b.s, (b.cy - a.cy) * b.s)
      assert.ok(step < 60, `jump of ${step.toFixed(1)} px at frame ${i}`)
      assert.ok(Math.abs(Math.log(b.s / a.s)) < 0.06, `zoom jump at frame ${i}`)
    }
  })

  it('makes one move at a time', () => {
    const plan = planCamera(story(), DESKTOP)
    for (let i = 1; i < plan.moves.length; i++) {
      assert.ok(plan.moves[i].start >= plan.moves[i - 1].end - 1e-9, `${plan.moves[i].reason} overlaps ${plan.moves[i - 1].reason}`)
    }
  })

  it('arrives before the click: still from 300 ms before each press to 300 ms after', () => {
    const l = story()
    const plan = planCamera(l, DESKTOP)
    const presses = l.events.filter((e) => e.type === 'press')
    assert.ok(presses.length > 0)
    for (const p of presses) {
      const span = sampleTimes(plan)
        .map((t, i) => [t, plan.samples[i]] as const)
        .filter(([t]) => t >= p.t - RULES.settle && t <= p.t + RULES.after)
      for (const [, f] of span) assert.ok(same(f, span[0][1]), `camera moves around the press at ${p.t}`)
      // and the press point is well inside the frame
      assert.ok(inDeadzone(p, span[0][1], DESKTOP), 'press point not in the dead zone')
    }
  })

  it('starts the move into an action early so it settles before the press', () => {
    // The focus is logged only 0.5 s before the press: the move must start before it.
    const plan = planCamera(log([focus(0, 'context', ARTICLE), focus(2, 'action', PLAY), press(2.5, PLAY), { t: 5, type: 'end' }], 9), DESKTOP)
    const into = plan.moves.find((m) => m.reason.startsWith('action'))
    assert.ok(into)
    assert.ok(into.end <= 2.5 - RULES.settle + 1e-9, `arrives at ${into.end}`)
    assert.ok(into.start < 2)
  })

  it('holds long enough to read: 1.5 s minimum, 250 ms per word', () => {
    const plan = planCamera(
      log([focus(0, 'context', ARTICLE), focus(1.2, 'read', PARAGRAPH, { fontPx: 18, words: 20 }), focus(2, 'context', ARTICLE), { t: 3, type: 'end' }], 14),
      DESKTOP,
    )
    const into = plan.moves.find((m) => m.reason.startsWith('read'))
    const out = plan.moves.find((m) => m.start > (into?.end ?? 0))
    assert.ok(into && out)
    assert.ok(out.start - into.end >= 20 * RULES.perWord - 1e-9, `held ${out.start - into.end}s`)
    assert.ok(plan.moves[0].start >= RULES.openingHold - 1e-9, 'opening held under 1 s')
    // The context focus came 3 s too early, and the plan says so.
    assert.ok(
      plan.warnings.every((w) => w.includes('add a wait')),
      plan.warnings.join('; '),
    )
  })

  it('never chases a resting or still cursor', () => {
    const rest: TakeEvent[] = glide(4, 4.6, { x: 640, y: 420 }, { x: 1200, y: 760 }).map((e) => ({ ...e, rest: true }) as TakeEvent)
    const plan = planCamera(
      log([focus(0, 'context', ARTICLE), focus(1.2, 'read', PARAGRAPH, { fontPx: 18, hold: 1.5 }), ...rest, { t: 8, type: 'end' }], 12),
      DESKTOP,
    )
    assert.equal(plan.moves.filter((m) => m.reason === 'follow').length, 0)
  })

  it('reports a cursor left out of frame', () => {
    const away: TakeEvent[] = glide(3, 3.5, { x: 640, y: 400 }, { x: 40, y: 780 })
    const plan = planCamera(
      log(
        [
          { t: 0, type: 'cursor', x: 640, y: 400 },
          focus(0, 'context', ARTICLE),
          focus(1.2, 'read', PARAGRAPH, { fontPx: 13, hold: 1.5 }),
          ...away,
          { t: 6, type: 'end' },
        ],
        10,
      ),
      DESKTOP,
    )
    assert.ok(
      plan.warnings.some((w) => w.includes('out of frame')),
      plan.warnings.join('; '),
    )
  })

  it('lets an explicit hold replace the per-word hold', () => {
    const plan = planCamera(
      log(
        [focus(0, 'context', ARTICLE), focus(1.2, 'read', PARAGRAPH, { fontPx: 18, words: 40, hold: 2 }), focus(5, 'context', ARTICLE), { t: 7, type: 'end' }],
        11,
      ),
      DESKTOP,
    )
    const out = plan.moves.find((m) => m.reason === 'context: context@5')
    assert.ok(out && out.start <= 5 + 1e-9, `waited for 40 words: ${out?.start}`)
  })

  it('never moves into an action after its press, even when the previous hold is long', () => {
    const plan = planCamera(
      log(
        [
          focus(0, 'context', ARTICLE),
          focus(1.2, 'read', PARAGRAPH, { fontPx: 18, words: 30 }),
          focus(4, 'action', PLAY),
          press(4.8, PLAY),
          { t: 9, type: 'end' },
        ],
        13,
      ),
      DESKTOP,
    )
    const into = plan.moves.find((m) => m.reason.startsWith('action'))
    assert.ok(into && into.end <= 4.8 - RULES.settle + 1e-9, `arrives at ${into?.end}`)
    assert.ok(
      plan.warnings.some((w) => w.includes('less than its')),
      'the cut hold is not reported',
    )
  })

  it('follows the cursor while zoomed, so it never leaves the frame', () => {
    const l = log(
      [
        focus(0, 'context', ARTICLE),
        focus(1.2, 'read', { x: 100, y: 300, w: 1100, h: 60 }, { fontPx: 18, hold: 1.5 }),
        ...glide(2.5, 6.5, { x: 110, y: 320 }, { x: 1180, y: 340 }),
        { t: 9, type: 'end' },
      ],
      12.5,
    )
    const plan = planCamera(l, DESKTOP)
    assert.ok(
      plan.moves.some((m) => m.reason === 'follow'),
      'no follow pan',
    )
    const cursor = l.events.filter((e) => e.type === 'cursor')
    for (const c of cursor) {
      const f = plan.samples[Math.min(plan.samples.length - 1, Math.round(c.t * plan.fps))]
      const o = toOutput(c, f, DESKTOP)
      assert.ok(o.x >= 0 && o.x <= DESKTOP.width && o.y >= 0 && o.y <= DESKTOP.height, `cursor off frame at ${c.t.toFixed(2)}s`)
    }
  })

  it('follows a tracked element (a word being read) line by line', () => {
    const words: TakeEvent[] = []
    for (let i = 0; i < 40; i++) {
      const line = Math.floor(i / 10)
      words.push({ t: 3 + i * 0.15, type: 'track', name: 'word', box: { x: 120 + (i % 10) * 100, y: 300 + line * 30, w: 60, h: 24 } })
    }
    const plan = planCamera(
      log(
        [focus(0, 'context', ARTICLE), focus(1, 'read', { x: 100, y: 290, w: 1100, h: 130 }, { fontPx: 18, hold: 1.5 }), ...words, { t: 10, type: 'end' }],
        13,
      ),
      DESKTOP,
    )
    assert.ok(plan.moves.filter((m) => m.reason === 'follow').length >= 2, 'did not follow the reading')
  })

  it('pulls back to the opening framing at the end and holds it', () => {
    const plan = planCamera(story(), DESKTOP)
    const last = plan.samples[plan.samples.length - 1]
    assert.ok(same(last, plan.opening))
    const holdFrames = Math.round(RULES.endHold * plan.fps)
    for (const f of plan.samples.slice(-holdFrames)) assert.ok(same(f, plan.opening))
    assert.ok(same(plan.samples[0], plan.opening))
  })

  it('warns when the take ends too soon for the pull-back', () => {
    const plan = planCamera(log([focus(0, 'context', ARTICLE), focus(1.2, 'read', PARAGRAPH, { fontPx: 18 }), { t: 3, type: 'end' }], 3.5), DESKTOP)
    assert.ok(plan.warnings.some((w) => w.includes('ends too soon')))
  })

  it('keeps the window inside the page', () => {
    for (const profile of [DESKTOP, PHONE]) {
      const plan = planCamera(story(), profile)
      for (const f of plan.samples) {
        const w = windowOf(f, profile)
        assert.ok(w.x >= -1e-6 && w.y >= -1e-6, `${profile.name} window off the top-left`)
        assert.ok(w.x + w.w <= VIEWPORT.width + 1e-6 && w.y + w.h <= VIEWPORT.height + 1e-6, `${profile.name} window off the bottom-right`)
      }
    }
  })
})

describe('edge snapping', () => {
  it('moves the frame edge off a text line, keeping the subject in view', () => {
    const f: Framing = { cx: 640, cy: 400, s: 2 } // window y 200-600
    const lines: Box[] = [
      { x: 300, y: 180, w: 600, h: 40 }, // cut by the top edge
      { x: 300, y: 380, w: 600, h: 30 },
    ]
    const snapped = snapEdges(f, lines, { x: 300, y: 380, w: 600, h: 30 }, DESKTOP, VIEWPORT)
    const w = windowOf(snapped, DESKTOP)
    assert.ok(!(w.y > 180 && w.y < 220), `top edge at ${w.y} still cuts the line`)
    assert.ok(Math.abs(snapped.cy - 400) <= 0.15 * 400 + 1e-9)
  })

  it('drops a sliver of a line left at a side edge', () => {
    const f: Framing = { cx: 640, cy: 400, s: 2.5 } // window x 384-896, y 240-560
    const corner: Box = { x: 300, y: 250, w: 100, h: 16 } // 16 px of it would show in the corner
    const snapped = snapEdges(f, [corner], { x: 600, y: 380, w: 100, h: 32 }, DESKTOP, VIEWPORT)
    assert.ok(windowOf(snapped, DESKTOP).y >= 266 - 1e-9, `the sliver is still in frame at ${windowOf(snapped, DESKTOP).y}`)
  })

  it('leaves a clean frame alone', () => {
    const f: Framing = { cx: 640, cy: 400, s: 2 }
    assert.deepEqual(snapEdges(f, [{ x: 300, y: 300, w: 600, h: 30 }], undefined, DESKTOP, VIEWPORT), f)
  })
})

describe('phone cut (390x760)', () => {
  const plan = planCamera(story(), PHONE)
  const p: Profile = PHONE

  it('always fills the portrait frame (no bars)', () => {
    for (const f of plan.samples) assert.ok(f.s >= 760 / 800 - 1e-9, `phone scale ${f.s}`)
  })

  it('makes the read text at least 14 px tall on the phone', () => {
    const s = plan.samples[Math.round(5 * plan.fps)].s
    assert.ok(18 * s >= RULES.minReadablePx, `18 px text shown at ${(18 * s).toFixed(1)} px`)
  })

  it('keeps the press point in frame and still', () => {
    const f = plan.samples[Math.round(7.1 * plan.fps)]
    const o = toOutput({ x: PLAY.x + 14, y: PLAY.y + 14 }, f, p)
    assert.ok(o.x > 0 && o.x < p.width && o.y > 0 && o.y < p.height)
    const before = plan.samples[Math.round((7.1 - RULES.settle) * plan.fps)]
    assert.ok(same(before, f))
  })
})
