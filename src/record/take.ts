// The take: a screencast of one tab plus a log of everything the storyboard
// did, on one clock. Nothing is drawn in the page; the cursor and click
// ripples are drawn in post from this log, and the real mouse moves along the
// same eased paths so hovers and selections happen for real.

import { mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import type { Box, FocusEvent, FocusKind, Point, TakeEvent } from '../types.ts'

/** Something on the page: a Playwright locator, a CSS selector, a box or a point (CSS px). */
export type Target = Locator | string | Box | Point

export interface FocusOptions {
  kind?: FocusKind
  fontPx?: number
  words?: number
  hold?: number
  emphasis?: boolean
}

export interface PressOptions {
  name?: string
  /** Zoom one step further for this press: the key moment of the clip. */
  emphasis?: boolean
  /** What the camera frames for the press (default: the target). `false` logs no focus. */
  frame?: Target | false
  /** Glide duration in ms (default: by distance). */
  ms?: number
}

export interface SelectOptions {
  name?: string
  /** Log a `read` focus on the selected text (default true). */
  focus?: boolean
  hold?: number
  /** Drag duration in ms (default: by length). */
  ms?: number
}

export interface TakeResult {
  frames: { t: number; file: string }[]
  events: TakeEvent[]
  duration: number
}

type Stamped = TakeEvent & { at: number }

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)

/** Glide duration by distance in CSS px: clamp(350 + 0.6 * px, 400, 1100) ms (the playbook's cursor rule). */
export const glideMs = (px: number) => clamp(350 + 0.6 * px, 400, 1100)

export class Take {
  readonly page: Page
  private readonly dir: string
  private readonly scale: number
  private readonly fps: number
  private readonly viewport: { width: number; height: number }
  private stamped: Stamped[] = []
  private frames: { at: number; file: string }[] = []
  private cuts: Array<[number, number]> = []
  private writes: Promise<void>[] = []
  private startAt = 0
  private recording = false
  private pos: Point
  private stopScreencast: (() => Promise<void>) | null = null

  constructor(page: Page, opts: { dir: string; scale: number; fps?: number; viewport: { width: number; height: number } }) {
    this.page = page
    this.dir = opts.dir
    this.scale = opts.scale
    this.fps = opts.fps ?? 30
    this.viewport = opts.viewport
    this.pos = { x: opts.viewport.width - 140, y: opts.viewport.height / 2 }
  }

  /** The cursor's current position (CSS px). */
  get cursor(): Point {
    return { ...this.pos }
  }

  private log(e: TakeEvent) {
    if (this.recording) this.stamped.push({ ...e, at: Date.now() })
  }

  /** Starts the screencast. The cursor appears at `cursor` (default: the right margin). */
  async start(opts: { cursor?: Point } = {}): Promise<void> {
    if (opts.cursor) this.pos = { ...opts.cursor }
    await this.page.mouse.move(this.pos.x, this.pos.y)
    mkdirSync(join(this.dir, 'frames'), { recursive: true })
    let n = 0
    this.startAt = Date.now()
    this.recording = true
    await this.page.screencast.start({
      size: { width: this.viewport.width * this.scale, height: this.viewport.height * this.scale },
      quality: 92,
      fps: this.fps,
      onFrame: (f) => {
        if (!this.recording) return
        const file = `frames/${String(n++).padStart(6, '0')}.jpg`
        this.frames.push({ at: f.timestamp, file })
        this.writes.push(writeFile(join(this.dir, file), f.data))
      },
    })
    this.stopScreencast = () => this.page.screencast.stop()
    this.log({ t: 0, type: 'pointer', style: 'arrow' })
    this.log({ t: 0, type: 'cursor', ...this.pos })
    await this.layout()
  }

  /** A target's box in CSS px. */
  async box(target: Target, timeout?: number): Promise<Box> {
    if (typeof target === 'string') return this.box(this.page.locator(target).first(), timeout)
    if ('boundingBox' in target) {
      const b = await target.boundingBox({ timeout })
      if (!b) throw new Error(`not visible: ${target}`)
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    }
    if ('w' in target) return target
    return { x: target.x, y: target.y, w: 0, h: 0 }
  }

  private async point(target: Target): Promise<Point> {
    const b = await this.box(target)
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  }

  private locator(target: Target): Locator | null {
    if (typeof target === 'string') return this.page.locator(target).first()
    return 'boundingBox' in target ? target : null
  }

  /** Moves the real mouse along an eased path with a slight arc, logging each step. */
  async glide(target: Target, opts: { ms?: number; arc?: number; rest?: boolean } = {}): Promise<void> {
    const to = await this.point(target)
    const from = { ...this.pos }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.hypot(dx, dy)
    if (dist < 0.5) return
    const ms = opts.ms ?? glideMs(dist)
    // The arc bows to one side of the straight line, never more than 40 px.
    const bow = Math.min(40, dist * 0.06) * (opts.arc ?? 1)
    const nx = -dy / dist
    const ny = dx / dist
    const sign = ny > 0 ? -1 : 1
    const t0 = Date.now()
    for (;;) {
      const stepStart = Date.now()
      const u = Math.min(1, (stepStart - t0) / ms)
      const k = easeInOutCubic(u)
      const b = Math.sin(Math.PI * k) * bow * sign
      const x = from.x + dx * k + nx * b
      const y = from.y + dy * k + ny * b
      await this.page.mouse.move(x, y)
      this.pos = { x, y }
      this.log(opts.rest ? { t: 0, type: 'cursor', x, y, rest: true } : { t: 0, type: 'cursor', x, y })
      if (u >= 1) break
      await sleep(Math.max(0, 16 - (Date.now() - stepStart)))
    }
  }

  /** Glides to a target, dwells 200 ms, clicks for real and holds 300 ms. Logs an `action` focus first. */
  async press(target: Target, opts: PressOptions = {}): Promise<void> {
    const box = await this.box(target)
    const name = opts.name ?? (typeof target === 'string' ? target : 'press')
    if (opts.frame !== false) {
      await this.focus(name, opts.frame ?? box, { kind: 'action', emphasis: opts.emphasis })
    }
    await this.glide({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, { ms: opts.ms })
    await sleep(200)
    this.log({ t: 0, type: 'press', x: this.pos.x, y: this.pos.y, name })
    await this.page.mouse.down()
    await sleep(70)
    await this.page.mouse.up()
    await sleep(300)
  }

  /** Drags across an element's text to select it, with an I-beam cursor. Logs a `read` focus. */
  async select(target: Target, opts: SelectOptions = {}): Promise<void> {
    const loc = this.locator(target)
    if (!loc) throw new Error('select() needs a locator or selector')
    const ends = await loc.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      const rects = [...r.getClientRects()].filter((x) => x.width > 0)
      const a = rects[0]
      const z = rects[rects.length - 1]
      const style = getComputedStyle(el)
      return {
        start: { x: a.left + 1, y: a.top + a.height / 2 },
        end: { x: z.right - 1, y: z.top + z.height / 2 },
        fontPx: Number.parseFloat(style.fontSize),
        words: (el.textContent ?? '').trim().split(/\s+/).length,
      }
    })
    await this.glide(ends.start)
    this.log({ t: 0, type: 'pointer', style: 'text' })
    if (opts.focus !== false) {
      await this.focus(opts.name ?? 'selection', loc, { kind: 'read', fontPx: ends.fontPx, words: ends.words, hold: opts.hold })
    }
    await sleep(150)
    await this.page.mouse.down()
    this.log({ t: 0, type: 'down', ...this.pos })
    const dist = Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y)
    await this.glide(ends.end, { ms: opts.ms ?? clamp(600 + 1.2 * dist, 900, 2400), arc: 0 })
    await this.page.mouse.up()
    this.log({ t: 0, type: 'up', ...this.pos })
    this.log({ t: 0, type: 'pointer', style: 'arrow' })
    await sleep(200)
  }

  /** Logs a focus target: where the camera should look, and how. */
  async focus(name: string, target: Target, opts: FocusOptions = {}): Promise<void> {
    const box = await this.box(target)
    const kind = opts.kind ?? 'context'
    let { fontPx, words } = opts
    const loc = this.locator(target)
    if (loc && (kind === 'read' || kind === 'result') && (fontPx === undefined || (kind === 'read' && words === undefined))) {
      const info = await loc.evaluate((el) => ({
        fontPx: Number.parseFloat(getComputedStyle(el).fontSize),
        words: (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length,
      }))
      fontPx ??= info.fontPx
      if (kind === 'read') words ??= info.words
    }
    await this.layout()
    const e: FocusEvent = { t: 0, type: 'focus', name, kind, box }
    if (fontPx !== undefined) e.fontPx = fontPx
    if (words !== undefined) e.words = words
    if (opts.hold !== undefined) e.hold = opts.hold
    if (opts.emphasis) e.emphasis = true
    this.log(e)
  }

  /** Logs the visible text lines (one box per line of each text node), for the camera's edge snapping. */
  async layout(): Promise<void> {
    if (!this.recording) return
    const lines = await this.page
      .evaluate(() => {
        const out: Array<{ x: number; y: number; w: number; h: number }> = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        while (walker.nextNode()) {
          const node = walker.currentNode as Text
          if (!node.data.trim()) continue
          range.selectNodeContents(node)
          for (const r of range.getClientRects()) {
            if (r.width < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
            out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
          }
        }
        return out
      })
      .catch(() => [])
    this.log({ t: 0, type: 'layout', lines })
  }

  /** Samples a target's box every `every` ms for `ms`, so the camera can follow it (a word being read). */
  async track(name: string, target: Target, ms: number, every = 100): Promise<void> {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const started = Date.now()
      // A short timeout: the tracked element may be gone (the reading finished).
      const box = await this.box(target, Math.max(50, every / 2)).catch(() => null)
      if (box && box.w > 0) this.log({ t: 0, type: 'track', name, box })
      await sleep(Math.max(0, Math.min(every - (Date.now() - started), end - Date.now())))
    }
  }

  /** Waits. */
  async wait(ms: number): Promise<void> {
    await sleep(ms)
  }

  /** Waits and logs a hold (the camera's minimum hold is checked against it). */
  async hold(ms: number, reason?: string): Promise<void> {
    this.log({ t: 0, type: 'hold', seconds: ms / 1000, reason })
    await sleep(ms)
  }

  /**
   * Glides the cursor out of the way, where it stays in the shot: to a point,
   * just beside a target (right of it, level with its top; or just below its
   * bottom-right corner, for text that fills the frame), or by default a
   * little right of and below where it is. The camera never follows this glide.
   */
  async rest(at?: Point | { beside: Target; side?: 'right' | 'below' }): Promise<void> {
    let to: Point
    if (at && 'beside' in at) {
      const b = await this.box(at.beside)
      to = at.side === 'below' ? { x: b.x + b.w - 16, y: b.y + b.h + 10 } : { x: b.x + b.w + 28, y: b.y + Math.min(16, b.h / 3) }
    } else {
      to = at ?? { x: this.pos.x + 120, y: this.pos.y + 50 }
    }
    to = { x: clamp(to.x, 8, this.viewport.width - 40), y: clamp(to.y, 8, this.viewport.height - 40) }
    await this.glide(to, { rest: true })
  }

  /** Marks this moment as the poster frame. */
  poster(): void {
    this.log({ t: 0, type: 'poster' })
  }

  /** Runs `fn` and cuts its stretch from the take (a page load, a model warm-up). */
  async cut<T>(fn: () => Promise<T>): Promise<T> {
    const from = Date.now()
    try {
      return await fn()
    } finally {
      this.cuts.push([from, Date.now()])
    }
  }

  /** Logs the end: the camera pulls back to the opening framing and holds it, so the take runs on for that. */
  async end(): Promise<void> {
    this.log({ t: 0, type: 'end' })
    await sleep(2600)
  }

  /** Stops the screencast and returns the frames and events in take seconds, with cut stretches removed. */
  async stop(): Promise<TakeResult> {
    const stopAt = Date.now()
    this.recording = false
    await this.stopScreencast?.().catch(() => {})
    await Promise.all(this.writes)
    const cuts = this.cuts
    const inCut = (at: number) => cuts.some(([a, b]) => at > a && at < b)
    const removed = (at: number) => cuts.reduce((sum, [a, b]) => sum + (at >= b ? b - a : at > a ? at - a : 0), 0)
    const toT = (at: number) => Math.max(0, (at - this.startAt - removed(at)) / 1000)
    const frames: TakeResult['frames'] = []
    for (const f of this.frames) {
      if (inCut(f.at)) rmSync(join(this.dir, f.file), { force: true })
      else frames.push({ t: toT(f.at), file: f.file })
    }
    const events = this.stamped
      .filter((e) => !inCut(e.at) || e.type === 'focus' || e.type === 'end')
      .map(({ at, ...e }) => ({ ...e, t: Number(toT(at).toFixed(4)) }) as TakeEvent)
    return { frames, events, duration: toT(stopAt) }
  }
}
