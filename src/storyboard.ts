// The storyboard API: one file per product in storyboards/, e.g.
// storyboards/test-page.ts. A storyboard says what to load, how to set up the
// network and demo data (off camera), and what happens on camera.

import type { BrowserContext, Page, Worker } from 'playwright'
import type { Expectation } from './preflight.ts'
import type { Take } from './record/take.ts'

export interface SetupContext {
  context: BrowserContext
  page: Page
  /** The extension's service worker, when the storyboard loads an extension. */
  worker?: Worker
  extensionId?: string
  /** Resolves a path relative to the storyboard file (and expands ~). */
  resolve(path: string): string
}

export interface Storyboard {
  /** Short id, used for take folders and usage rows. */
  name: string
  /** What the clip shows, in one line. */
  title: string
  /** The storyboard table (see the playbook's template), for people reading the file. */
  notes?: string
  /** CSS px (default 1280x800). */
  viewport?: { width: number; height: number }
  /** Device scale factor (default 2). */
  scale?: number
  colorScheme?: 'light' | 'dark'
  /** Px the desktop cut is shown at, for the readability zoom (default 640, a homepage card). */
  displayWidth?: number
  /** Click ripple colour: the product's accent. */
  accent?: string
  /** Cuts to render (default both). */
  outputs?: Array<'desktop' | 'phone'>
  /** The unpacked extension to load, and the git ref its build must match. */
  extension?: {
    path: string
    expect?: Expectation
  }
  /** Off camera: routes, fixtures, seeded storage, warm-ups, and opening the page. */
  setup?(ctx: SetupContext): Promise<void>
  /** On camera. Call take.start() first and take.end() last. */
  run(take: Take, ctx: SetupContext): Promise<void>
}

export function defineStoryboard(s: Storyboard): Storyboard {
  return s
}
