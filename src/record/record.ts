// `demo-kit record <storyboard>`: pre-flight, launch, set up off camera, run
// the take, and write takes/<name>-<stamp>/take.json with its frames.

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Expectation, expandHome, formatReport, passed, preflightBrowser, preflightFiles } from '../preflight.ts'
import type { SetupContext, Storyboard } from '../storyboard.ts'
import type { BuildReport, TakeLog } from '../types.ts'
import { launch } from './launch.ts'
import { Take } from './take.ts'

export interface RecordOptions {
  /** Overrides the storyboard's expectation: the repo and ref the build must match. */
  expect?: Expectation
  /** Record without the build check; the take and usage row say so. */
  skipPreflight?: boolean
  headed?: boolean
  /** Where take folders go (default: takes/ in demo-kit). */
  outDir: string
  fps?: number
}

export interface RecordResult {
  takeDir: string
  log: TakeLog
  wallSeconds: number
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')

export async function loadStoryboard(file: string): Promise<{ storyboard: Storyboard; path: string }> {
  const path = resolve(file)
  const mod = (await import(pathToFileURL(path).href)) as { default?: Storyboard }
  if (!mod.default?.run) throw new Error(`${file} has no default export from defineStoryboard()`)
  return { storyboard: mod.default, path }
}

export async function record(file: string, opts: RecordOptions): Promise<RecordResult> {
  const began = Date.now()
  const { storyboard: sb, path } = await loadStoryboard(file)
  const here = dirname(path)
  const resolvePath = (p: string) => resolve(here, expandHome(p))
  const viewport = sb.viewport ?? { width: 1280, height: 800 }
  const scale = sb.scale ?? 2
  const takeDir = join(resolve(opts.outDir), `${sb.name}-${stamp()}`)
  mkdirSync(takeDir, { recursive: true })

  // Pre-flight, before a browser starts.
  let build: BuildReport | undefined
  const extDir = sb.extension ? resolvePath(sb.extension.path) : undefined
  if (extDir) {
    const exp = opts.expect ?? (sb.extension?.expect && { ...sb.extension.expect, repo: resolvePath(sb.extension.expect.repo) })
    if (opts.skipPreflight) {
      build = { checked: false, extension: extDir, checks: [] }
      console.warn('pre-flight skipped: this take is not checked against any git ref')
    } else {
      if (!exp) throw new Error('the storyboard loads an extension: pass --expect <repo>@<ref> (or set extension.expect), or --skip-preflight')
      build = preflightFiles(extDir, exp)
      console.log(formatReport(build))
      if (!passed(build)) throw new Error('pre-flight failed: refusing to record a build that does not match the ref')
    }
  }

  const session = await launch({ workDir: takeDir, viewport, scale, colorScheme: sb.colorScheme, extension: extDir, headed: opts.headed })
  let log: TakeLog
  try {
    if (build?.checked && session.worker && extDir) {
      await preflightBrowser(session.worker, extDir, build)
      const failed = build.checks.filter((c) => c.name.startsWith('browser') && !c.ok)
      if (failed.length) throw new Error(`pre-flight failed in the browser:\n${formatReport(build)}`)
    }
    const ctx: SetupContext = {
      context: session.context,
      page: session.page,
      worker: session.worker,
      extensionId: session.extensionId,
      resolve: resolvePath,
    }
    await sb.setup?.(ctx)
    await session.page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => true)
    const take = new Take(session.page, { dir: takeDir, scale, fps: opts.fps ?? 30, viewport })
    let result: Awaited<ReturnType<Take['stop']>>
    try {
      await sb.run(take, ctx)
    } finally {
      result = await take.stop()
    }
    if (!result.frames.length) throw new Error('the take has no frames')
    log = {
      version: 1,
      storyboard: sb.name,
      title: sb.title,
      recordedAt: new Date(began).toISOString(),
      viewport,
      scale,
      duration: result.duration,
      displayWidth: sb.displayWidth ?? 640,
      accent: sb.accent ?? '#4f46e5',
      frames: result.frames,
      events: result.events,
      build,
    }
    writeFileSync(join(takeDir, 'take.json'), `${JSON.stringify(log, null, 1)}\n`)
  } finally {
    await session.close()
  }
  console.log(`${basename(takeDir)}: ${log.frames.length} frames, ${log.duration.toFixed(2)} s, ${log.events.length} events`)
  return { takeDir, log, wallSeconds: (Date.now() - began) / 1000 }
}
