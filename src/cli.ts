// demo-kit: record a storyboard, render a take, check a build, show usage.
//
//   demo-kit record <storyboard.ts> [--expect <repo>@<ref>] [--skip-preflight] [--headed] [--out <dir>]
//   demo-kit render <take-dir> [--only desktop|phone] [--concurrency <n>]
//   demo-kit plan <take-dir> [--strict]            camera plans and warnings, no render
//   demo-kit preflight --ext <dir> --expect <repo>@<ref> [--forbid <word>]...
//   demo-kit usage [--json]
//   demo-kit usage note <take> --tokens "<text>"

import { statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DESKTOP, PHONE, PROFILES, type Profile, planCamera } from './camera/plan.ts'
import { formatReport, parseExpect, passed, preflightFiles } from './preflight.ts'
import { loadStoryboard, record } from './record/record.ts'
import { readTake, renderTake } from './render/render.ts'
import { appendUsage, formatTable, readUsage, summarize } from './usage.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE_FILE = process.env.DEMO_KIT_USAGE ?? join(ROOT, 'usage.jsonl')
const TAKES = process.env.DEMO_KIT_TAKES ?? join(ROOT, 'takes')

const HELP = `demo-kit: record polished product demo clips

  demo-kit record <storyboard.ts> [--expect <repo>@<ref>] [--skip-preflight] [--headed] [--out <dir>]
  demo-kit render <take-dir> [--only desktop|phone] [--concurrency <n>]
  demo-kit plan <take-dir> [--strict]
  demo-kit preflight --ext <dir> --expect <repo>@<ref> [--forbid <word>]...
  demo-kit usage [--json]
  demo-kit usage note <take> --tokens "<text>"
`

const takeName = (dir: string) => basename(resolve(dir))

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'record': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          expect: { type: 'string' },
          'skip-preflight': { type: 'boolean' },
          headed: { type: 'boolean' },
          out: { type: 'string' },
        },
      })
      const file = positionals[0]
      if (!file) throw new Error('usage: demo-kit record <storyboard.ts>')
      const res = await record(file, {
        expect: values.expect ? parseExpect(values.expect) : undefined,
        skipPreflight: values['skip-preflight'],
        headed: values.headed,
        outDir: values.out ?? TAKES,
      })
      appendUsage(USAGE_FILE, {
        kind: 'record',
        at: new Date().toISOString(),
        take: takeName(res.takeDir),
        storyboard: res.log.storyboard,
        wallSeconds: round1(res.wallSeconds),
        frames: res.log.frames.length,
        durationSeconds: round1(res.log.duration),
        preflight: !res.log.build ? 'none' : res.log.build.checked ? 'passed' : 'skipped',
      })
      console.log(`take: ${relativeOrAbsolute(res.takeDir)}\nnext: demo-kit render ${relativeOrAbsolute(res.takeDir)}`)
      return 0
    }
    case 'render': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { only: { type: 'string' }, concurrency: { type: 'string' } },
      })
      const dir = positionals[0]
      if (!dir) throw new Error('usage: demo-kit render <take-dir>')
      const began = Date.now()
      const log = readTake(dir)
      const storyboardOutputs = await outputsOf(log.storyboard)
      const names = values.only ? [values.only] : storyboardOutputs
      const profiles: Profile[] = names.map((n) => {
        const p = PROFILES[n]
        if (!p) throw new Error(`unknown cut ${n}: desktop or phone`)
        return p
      })
      const outputs = await renderTake(dir, { profiles, concurrency: values.concurrency ? Number(values.concurrency) : undefined })
      const wall = (Date.now() - began) / 1000
      appendUsage(USAGE_FILE, {
        kind: 'render',
        at: new Date().toISOString(),
        take: takeName(dir),
        storyboard: log.storyboard,
        wallSeconds: round1(wall),
        outputs: outputs.map((o) => ({ profile: o.profile, frames: o.frames, files: o.files.map((f) => ({ file: basename(f.file), bytes: f.bytes })) })),
      })
      for (const o of outputs) for (const f of o.files) console.log(`${relativeOrAbsolute(f.file)}  ${(f.bytes / 1024).toFixed(0)} KB`)
      console.log(`rendered in ${wall.toFixed(1)} s`)
      return 0
    }
    case 'plan': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { strict: { type: 'boolean' } } })
      const dir = positionals[0]
      if (!dir) throw new Error('usage: demo-kit plan <take-dir> [--strict]')
      const log = readTake(dir)
      let desktopWarnings = 0
      for (const profile of [DESKTOP, PHONE]) {
        const plan = planCamera(log, profile)
        console.log(`${profile.name}: opening ${plan.opening.s.toFixed(2)}x, ${plan.moves.length} moves`)
        for (const m of plan.moves) console.log(`  ${m.start.toFixed(2)}-${m.end.toFixed(2)}s  ${m.from.s.toFixed(2)}x -> ${m.to.s.toFixed(2)}x  ${m.reason}`)
        for (const w of plan.warnings) console.log(`  warning: ${w}`)
        if (profile === DESKTOP) desktopWarnings = plan.warnings.length
      }
      // --strict: the desktop plan must follow every rule (the phone crop may lose a moving cursor briefly).
      return values.strict && desktopWarnings ? 1 : 0
    }
    case 'preflight': {
      const { values } = parseArgs({
        args: rest,
        options: { ext: { type: 'string' }, expect: { type: 'string' }, forbid: { type: 'string', multiple: true } },
      })
      if (!values.ext || !values.expect) throw new Error('usage: demo-kit preflight --ext <dir> --expect <repo>@<ref>')
      const report = preflightFiles(values.ext, { ...parseExpect(values.expect), forbid: values.forbid })
      console.log(formatReport(report))
      return passed(report) ? 0 : 1
    }
    case 'usage': {
      if (rest[0] === 'note') {
        const { values, positionals } = parseArgs({ args: rest.slice(1), allowPositionals: true, options: { tokens: { type: 'string' } } })
        if (!positionals[0] || !values.tokens) throw new Error('usage: demo-kit usage note <take> --tokens "<text>"')
        appendUsage(USAGE_FILE, { kind: 'note', at: new Date().toISOString(), take: takeName(positionals[0]), tokens: values.tokens })
        return 0
      }
      const rows = summarize(readUsage(USAGE_FILE))
      console.log(rest.includes('--json') ? JSON.stringify(rows, null, 2) : formatTable(rows))
      return 0
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return 0
    default:
      console.error(`unknown command: ${command}\n\n${HELP}`)
      return 2
  }
}

/** The cuts a take's storyboard asks for (both when its file is gone). */
async function outputsOf(name: string): Promise<string[]> {
  const file = join(ROOT, 'storyboards', `${name}.ts`)
  try {
    statSync(file)
    const { storyboard } = await loadStoryboard(file)
    return storyboard.outputs ?? ['desktop', 'phone']
  } catch {
    return ['desktop', 'phone']
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10
const relativeOrAbsolute = (p: string) => {
  const r = relative(process.cwd(), p)
  return r.startsWith('..') ? p : r
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`demo-kit: ${err.message}`)
    process.exit(1)
  },
)
