// `demo-kit render <take>`: plan the camera for each cut, render it with
// Remotion and encode the web files into <take>/out/.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { type CameraPlan, type Profile, planCamera } from '../camera/plan.ts'
import type { FocusEvent, TakeEvent, TakeLog } from '../types.ts'
import { encode } from './encode.ts'
import type { ClipProps } from './remotion/Clip.tsx'

export interface RenderOptions {
  profiles: Profile[]
  fps?: number
  /** Remotion render concurrency (default 4: the machine is shared). */
  concurrency?: number
  /** Stop after the master render (no web files). */
  masterOnly?: boolean
}

export interface RenderOutput {
  profile: string
  frames: number
  plan: CameraPlan
  files: Array<{ file: string; bytes: number }>
}

export function readTake(takeDir: string): TakeLog {
  return JSON.parse(readFileSync(join(takeDir, 'take.json'), 'utf8')) as TakeLog
}

/** The poster: the moment the take marked, else a second after the last result appeared, else 60% in. */
export function posterTime(log: TakeLog): number {
  const marked = log.events.find((e) => e.type === 'poster')
  if (marked) return marked.t
  const results = log.events.filter((e): e is FocusEvent => e.type === 'focus' && e.kind === 'result')
  const last = results[results.length - 1]
  return last ? Math.min(log.duration - 0.5, last.t + 1) : log.duration * 0.6
}

export function clipProps(log: TakeLog, plan: CameraPlan, profile: Profile): ClipProps {
  type Cursor = Extract<TakeEvent, { type: 'cursor' }>
  type Pointer = Extract<TakeEvent, { type: 'pointer' }>
  type Press = Extract<TakeEvent, { type: 'press' }>
  return {
    width: profile.width,
    height: profile.height,
    fps: plan.fps,
    durationInFrames: plan.samples.length,
    viewport: log.viewport,
    frames: log.frames,
    samples: plan.samples.map((f) => ({ cx: round(f.cx), cy: round(f.cy), s: Number(f.s.toFixed(5)) })),
    cursor: log.events.filter((e): e is Cursor => e.type === 'cursor'),
    pointer: log.events.filter((e): e is Pointer => e.type === 'pointer').map((e) => ({ t: e.t, style: e.style })),
    presses: log.events.filter((e): e is Press => e.type === 'press').map((e) => ({ t: e.t, x: e.x, y: e.y })),
    cursorPx: profile.cursorPx,
    accent: log.accent,
    background: '#000000',
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000

export async function renderTake(takeDir: string, opts: RenderOptions): Promise<RenderOutput[]> {
  const dir = resolve(takeDir)
  const log = readTake(dir)
  const fps = opts.fps ?? 30
  const outDir = join(dir, 'out')
  mkdirSync(outDir, { recursive: true })
  const bundleDir = join(dir, '.bundle')
  rmSync(bundleDir, { recursive: true, force: true })
  const serveUrl = await bundle({
    entryPoint: new URL('./remotion/index.tsx', import.meta.url).pathname,
    publicDir: dir,
    symlinkPublicDir: true,
    outDir: bundleDir,
    onProgress: () => {},
  })
  const results: RenderOutput[] = []
  try {
    for (const profile of opts.profiles) {
      const plan = planCamera(log, profile, { fps })
      writeFileSync(join(dir, `camera-${profile.name}.json`), `${JSON.stringify(plan, null, 1)}\n`)
      for (const w of plan.warnings) console.warn(`camera (${profile.name}): ${w}`)
      const inputProps = clipProps(log, plan, profile)
      const composition = await selectComposition({ serveUrl, id: 'Clip', inputProps })
      const master = join(dir, `master-${profile.name}.mp4`)
      let last = -1
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        codec: 'h264',
        crf: 12,
        imageFormat: 'jpeg',
        jpegQuality: 95,
        muted: true,
        enforceAudioTrack: false,
        concurrency: opts.concurrency ?? 4,
        outputLocation: master,
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 10) * 10
          if (pct !== last) {
            last = pct
            process.stdout.write(`\r${profile.name}: rendering ${pct}%`)
          }
        },
      })
      process.stdout.write('\n')
      const files = opts.masterOnly ? [] : encode(master, outDir, profile.name, { posterAt: posterTime(log), fps })
      results.push({ profile: profile.name, frames: plan.samples.length, plan, files })
    }
  } finally {
    rmSync(bundleDir, { recursive: true, force: true })
  }
  return results
}
