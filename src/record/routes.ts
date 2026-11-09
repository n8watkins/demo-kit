// Network for a take: nothing live. Pages and API answers come from fixtures,
// and anything not routed is refused, so a take never depends on a live site.
//
// Playwright runs the most recently registered matching route first, so call
// `offline()` before the fixture routes: it is the catch-all that runs last.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { BrowserContext } from 'playwright'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * Refuses every request that no later route answers, except the allowed ones
 * (origins such as `http://127.0.0.1:7477`, or regular expressions), which
 * go to the network: local services like a TTS engine, warmed before the take.
 */
export async function offline(context: BrowserContext, allow: Array<string | RegExp> = []): Promise<string[]> {
  const refused: string[] = []
  await context.route('**/*', (route) => {
    const url = route.request().url()
    const ok = allow.some((a) => (typeof a === 'string' ? url === a || url.startsWith(a.endsWith('/') ? a : `${a}/`) : a.test(url)))
    if (ok) return route.continue()
    refused.push(url)
    return route.abort('blockedbyclient')
  })
  return refused
}

/** Serves a folder at an origin, e.g. `serveDir(ctx, 'https://demo.test', 'fixtures/test-page/site')`. */
export async function serveDir(context: BrowserContext, origin: string, dir: string): Promise<void> {
  const root = resolve(dir)
  const base = origin.replace(/\/$/, '')
  await context.route(`${base}/**`, (route) => {
    const url = new URL(route.request().url())
    let path = decodeURIComponent(url.pathname)
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(root, path))
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: `not in the fixture: ${path}` })
    }
    return route.fulfill({
      status: 200,
      contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      body: readFileSync(file),
      headers: { 'cache-control': 'no-store' },
    })
  })
}

export interface Reply {
  status?: number
  /** A JSON body. */
  json?: unknown
  /** A text body. */
  body?: string
  /** A file whose bytes are the body. */
  path?: string
  contentType?: string
  headers?: Record<string, string>
  /** Answer after this many ms, about as long as the real service takes. */
  delayMs?: number
}

/**
 * Answers requests matching `url` (a glob, a RegExp or a predicate) with a
 * recorded reply. Replies must be genuine responses captured once from the
 * real service, so the clip stays honest.
 */
export async function replay(
  context: BrowserContext,
  url: string | RegExp | ((u: URL) => boolean),
  reply: Reply | ((request: { url: string; method: string; body: string | null }) => Reply | Promise<Reply>),
): Promise<void> {
  await context.route(url, async (route) => {
    const req = route.request()
    const r = typeof reply === 'function' ? await reply({ url: req.url(), method: req.method(), body: req.postData() }) : reply
    if (r.delayMs) await new Promise((done) => setTimeout(done, r.delayMs))
    if (r.json !== undefined) return route.fulfill({ status: r.status ?? 200, json: r.json, headers: r.headers })
    return route.fulfill({
      status: r.status ?? 200,
      contentType: r.contentType ?? (r.path ? TYPES[extname(r.path).toLowerCase()] : 'text/plain; charset=utf-8'),
      body: r.path ? readFileSync(r.path) : (r.body ?? ''),
      headers: r.headers,
    })
  })
}

/** Replays a HAR file captured from the real service; requests not in it are refused. */
export async function replayHar(context: BrowserContext, har: string, url?: string | RegExp): Promise<void> {
  await context.routeFromHAR(har, { url, notFound: 'abort' })
}
