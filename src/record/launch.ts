// Launches the browser for a take: Playwright's Chromium with a throwaway
// persistent profile, the extension under test (if any) loaded unpacked, and
// frames at 2x.
//
// Sharp frames need both `deviceScaleFactor` and `--force-device-scale-factor`:
// with the context option alone the screencast delivers 1280x800 frames, and
// with the flag alone the page reports devicePixelRatio 1 (so images pick
// their 1x sources). Together the page is 1280x800 CSS at DPR 2 and the
// screencast frames are 2560x1600.

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { type BrowserContext, chromium, type Page, type Worker } from 'playwright'

export interface LaunchOptions {
  /** Folder the throwaway profile is created in (a fresh subfolder per take). */
  workDir: string
  viewport: { width: number; height: number }
  scale: number
  colorScheme?: 'light' | 'dark'
  /** Unpacked extension folder to load. */
  extension?: string
  /** Run with a visible window (needs a display, e.g. under xvfb-run). */
  headed?: boolean
  env?: Record<string, string>
}

export interface Session {
  context: BrowserContext
  page: Page
  profileDir: string
  worker?: Worker
  extensionId?: string
  close(): Promise<void>
}

export async function launch(opts: LaunchOptions): Promise<Session> {
  const profileDir = mkdtempSync(join(opts.workDir, 'profile-'))
  const args = [
    `--force-device-scale-factor=${opts.scale}`,
    '--mute-audio',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
  ]
  if (opts.extension) args.push(`--disable-extensions-except=${opts.extension}`, `--load-extension=${opts.extension}`)
  const context = await chromium.launchPersistentContext(profileDir, {
    // The full Chromium build: the headless shell cannot load extensions.
    channel: 'chromium',
    headless: !opts.headed,
    viewport: opts.viewport,
    deviceScaleFactor: opts.scale,
    colorScheme: opts.colorScheme ?? 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'no-preference',
    args,
    env: opts.env ? ({ ...process.env, ...opts.env } as Record<string, string>) : undefined,
  })
  let worker: Worker | undefined
  let extensionId: string | undefined
  if (opts.extension) {
    worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
    worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 })
    extensionId = new URL(worker.url()).host
  }
  const page = context.pages()[0] ?? (await context.newPage())
  return {
    context,
    page,
    profileDir,
    worker,
    extensionId,
    async close() {
      await context.close().catch(() => {})
      rmSync(profileDir, { recursive: true, force: true })
    },
  }
}
