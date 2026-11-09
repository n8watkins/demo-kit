// Pre-flight: refuse to record a stale build.
//
// The 2026-11-09 clips showed an old icon and old names because the recorder
// loaded whatever sat in a local checkout. This compares the extension folder
// that is about to be loaded with the same folder at a git ref (by default the
// remote default branch), and then checks that the browser really loaded it:
//
// - the manifest's name, version, short_name and action title match the ref;
// - every icon the manifest names is byte-identical to the ref's;
// - when the folder is tracked in git, no file in it differs from the ref;
// - optional forbidden strings (old product names) appear nowhere in it;
// - in the browser, chrome.runtime.getManifest() and the served icons match the folder.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import type { Worker } from 'playwright'
import type { BuildReport, PreflightCheck } from './types.ts'

export interface Expectation {
  /** The extension's git repo. */
  repo: string
  /** The ref the build must match, e.g. `origin/main` (default) or `HEAD`. */
  ref?: string
  /** The extension folder's path inside the repo at the ref (default: its path relative to the repo). */
  root?: string
  /** `git fetch` first when the ref is a remote branch (default true). */
  fetch?: boolean
  /** Strings that must not appear in the loaded folder (old names). */
  forbid?: string[]
}

/** Parses `--expect <repo>@<ref>`; the ref defaults to origin/main. */
export function parseExpect(spec: string): Expectation {
  const at = spec.lastIndexOf('@')
  if (at <= 0) return { repo: expandHome(spec) }
  return { repo: expandHome(spec.slice(0, at)), ref: spec.slice(at + 1) }
}

export const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p)

const git = (repo: string, args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const gitBytes = (repo: string, args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
const sha256 = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex')

interface Manifest {
  name?: string
  short_name?: string
  version?: string
  icons?: Record<string, string>
  action?: { default_title?: string; default_icon?: string | Record<string, string> }
}

export function iconPaths(m: Manifest): string[] {
  const out = new Set<string>()
  for (const p of Object.values(m.icons ?? {})) out.add(p)
  const di = m.action?.default_icon
  if (typeof di === 'string') out.add(di)
  else for (const p of Object.values(di ?? {})) out.add(p)
  return [...out].map((p) => p.replace(/^\//, ''))
}

/** Checks the folder on disk against the ref. Throws nothing: every finding is a check. */
export function preflightFiles(extDir: string, exp: Expectation): BuildReport {
  const checks: PreflightCheck[] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  const ext = resolve(expandHome(extDir))
  const repo = resolve(expandHome(exp.repo))
  const ref = exp.ref ?? 'origin/main'
  const report: BuildReport = { checked: true, extension: ext, repo, ref, checks }

  const manifestFile = join(ext, 'manifest.json')
  if (!existsSync(manifestFile)) {
    add('manifest', false, `no manifest.json in ${ext}`)
    return report
  }
  const local = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
  report.name = local.name
  report.version = local.version

  let top: string
  try {
    top = git(repo, ['rev-parse', '--show-toplevel'])
  } catch {
    add('repo', false, `${repo} is not a git repo`)
    return report
  }
  if (exp.fetch !== false && /^[^/]+\/.+/.test(ref) && !ref.startsWith('refs/')) {
    const remote = ref.split('/')[0]
    try {
      git(top, ['fetch', '--quiet', remote])
      add('fetch', true, `fetched ${remote}`)
    } catch (e) {
      add('fetch', false, `git fetch ${remote} failed: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  let sha: string
  try {
    sha = git(top, ['rev-parse', '--verify', `${ref}^{commit}`])
    report.sha = sha
  } catch {
    add('ref', false, `${ref} does not resolve in ${top}`)
    return report
  }
  const inRepo = relative(top, ext)
  const root = exp.root ?? (inRepo.startsWith('..') ? null : inRepo)
  if (root === null) {
    add('root', false, `${ext} is outside ${top}: pass the extension's path inside the repo as root`)
    return report
  }
  const at = (p: string) => (root ? `${root}/${p}` : p)

  // The manifest at the ref.
  let theirs: Manifest
  try {
    theirs = JSON.parse(git(top, ['show', `${sha}:${at('manifest.json')}`])) as Manifest
  } catch {
    add('manifest', false, `no ${at('manifest.json')} at ${ref}`)
    return report
  }
  for (const key of ['name', 'short_name', 'version'] as const) {
    if (local[key] === undefined && theirs[key] === undefined) continue
    add(`manifest ${key}`, local[key] === theirs[key], `loaded ${JSON.stringify(local[key])}, ${ref} has ${JSON.stringify(theirs[key])}`)
  }
  if (local.action?.default_title !== undefined || theirs.action?.default_title !== undefined) {
    add(
      'manifest action title',
      local.action?.default_title === theirs.action?.default_title,
      `loaded ${JSON.stringify(local.action?.default_title)}, ${ref} has ${JSON.stringify(theirs.action?.default_title)}`,
    )
  }
  const mine = iconPaths(local)
  const refIcons = iconPaths(theirs)
  add(
    'icon list',
    JSON.stringify([...mine].sort()) === JSON.stringify([...refIcons].sort()),
    `loaded ${mine.join(', ') || 'none'}; ${ref} has ${refIcons.join(', ') || 'none'}`,
  )
  for (const icon of mine) {
    const file = join(ext, icon)
    if (!existsSync(file)) {
      add(`icon ${icon}`, false, 'missing in the loaded folder')
      continue
    }
    try {
      const want = sha256(gitBytes(top, ['show', `${sha}:${at(icon)}`]))
      add(`icon ${icon}`, sha256(readFileSync(file)) === want, `sha256 ${want.slice(0, 12)} at ${ref}`)
    } catch {
      add(`icon ${icon}`, false, `not at ${ref}`)
    }
  }

  // The whole folder, when it is tracked (a build folder like dist/ is not).
  const tracked = git(top, ['ls-files', '--', root || '.']).length > 0 && root === inRepo
  if (tracked) {
    const diff = git(top, ['diff', '--name-only', sha, '--', root || '.'])
    const untracked = git(top, ['ls-files', '--others', '--exclude-standard', '--', root || '.'])
    const changed = [diff, untracked].filter(Boolean).join('\n')
    add('files match ref', !changed, changed ? `differs from ${ref}: ${changed.split('\n').slice(0, 5).join(', ')}` : `every file matches ${ref}`)
  } else {
    add('files match ref', true, 'build folder (not tracked): manifest and icons checked only; rebuild it just before recording')
  }

  for (const word of exp.forbid ?? []) {
    const hits = grep(ext, word)
    add(`no "${word}"`, hits.length === 0, hits.length ? `found in ${hits.slice(0, 5).join(', ')}` : 'not found')
  }
  return report
}

function grep(dir: string, word: string): string[] {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.size < 5_000_000 && /\.(js|mjs|json|html|css|txt|md)$/i.test(name) && readFileSync(p, 'utf8').includes(word)) hits.push(relative(dir, p))
    }
  }
  walk(dir)
  return hits
}

/** Checks that the browser loaded this folder: its manifest and the icons it serves. */
export async function preflightBrowser(worker: Worker, extDir: string, report: BuildReport): Promise<BuildReport> {
  const ext = resolve(expandHome(extDir))
  const local = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8')) as Manifest
  const loaded = (await worker.evaluate(() => chrome.runtime.getManifest())) as Manifest
  report.checks.push({
    name: 'browser manifest',
    ok: loaded.name === local.name && loaded.version === local.version,
    detail: `the browser runs ${loaded.name} ${loaded.version}`,
  })
  for (const icon of iconPaths(local)) {
    const bytes = await worker.evaluate(async (p) => {
      const r = await fetch(chrome.runtime.getURL(p))
      return Array.from(new Uint8Array(await r.arrayBuffer()))
    }, icon)
    const served = sha256(Uint8Array.from(bytes))
    report.checks.push({ name: `browser icon ${icon}`, ok: served === sha256(readFileSync(join(ext, icon))), detail: `served sha256 ${served.slice(0, 12)}` })
  }
  return report
}

export const passed = (r: BuildReport) => r.checks.length > 0 && r.checks.every((c) => c.ok)

export function formatReport(r: BuildReport): string {
  const head = `pre-flight: ${r.name ?? '?'} ${r.version ?? '?'} from ${r.extension} against ${r.repo}@${r.ref}${r.sha ? ` (${r.sha.slice(0, 9)})` : ''}`
  return [head, ...r.checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)].join('\n')
}

declare const chrome: {
  runtime: { getManifest(): unknown; getURL(p: string): string }
}
