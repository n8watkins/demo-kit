// usage.jsonl: one line per record, render or note, so we know what each demo
// cost in wall time, frames, bytes and AI tokens. Not to optimise, just to know.
//
// - `record` and `render` lines are written by the CLI.
// - A `note` line carries the AI token usage of the session that produced the
//   clip, as free text. The orchestrating agent writes it when the recording
//   subagent finishes, from the totals it sees in the subagent's completion:
//     demo-kit usage note <take> --tokens "subagent: 182k tokens, 96 tool uses, 31 min"

import { appendFileSync, existsSync, readFileSync } from 'node:fs'

export type UsageEntry =
  | {
      kind: 'record'
      at: string
      take: string
      storyboard: string
      wallSeconds: number
      frames: number
      durationSeconds: number
      preflight: 'passed' | 'skipped' | 'none'
    }
  | {
      kind: 'render'
      at: string
      take: string
      storyboard: string
      wallSeconds: number
      outputs: Array<{ profile: string; frames: number; files: Array<{ file: string; bytes: number }> }>
    }
  | { kind: 'note'; at: string; take: string; tokens: string }

export function appendUsage(file: string, entry: UsageEntry): void {
  appendFileSync(file, `${JSON.stringify(entry)}\n`)
}

export function readUsage(file: string): UsageEntry[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageEntry)
}

export interface UsageRow {
  take: string
  storyboard: string
  recordSeconds?: number
  renderSeconds?: number
  frames?: number
  durationSeconds?: number
  sizes: string
  tokens: string
}

const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`)

/** One row per take: its record line, its latest render line and its notes. */
export function summarize(entries: UsageEntry[]): UsageRow[] {
  const rows = new Map<string, UsageRow>()
  const row = (take: string, storyboard = '') => {
    let r = rows.get(take)
    if (!r) {
      r = { take, storyboard, sizes: '', tokens: '' }
      rows.set(take, r)
    }
    if (storyboard) r.storyboard = storyboard
    return r
  }
  for (const e of entries) {
    if (e.kind === 'record') {
      const r = row(e.take, e.storyboard)
      r.recordSeconds = e.wallSeconds
      r.frames = e.frames
      r.durationSeconds = e.durationSeconds
    } else if (e.kind === 'render') {
      const r = row(e.take, e.storyboard)
      r.renderSeconds = e.wallSeconds
      r.sizes = e.outputs
        .flatMap((o) => o.files.filter((f) => /\.(mp4|webm)$/.test(f.file)).map((f) => `${o.profile}.${f.file.split('.').pop()} ${kb(f.bytes)}`))
        .join(', ')
    } else {
      const r = row(e.take)
      r.tokens = r.tokens ? `${r.tokens}; ${e.tokens}` : e.tokens
    }
  }
  return [...rows.values()]
}

export function formatTable(rows: UsageRow[]): string {
  const head = ['take', 'record s', 'render s', 'frames', 'clip s', 'sizes', 'tokens']
  const body = rows.map((r) => [
    r.take,
    r.recordSeconds?.toFixed(1) ?? '-',
    r.renderSeconds?.toFixed(1) ?? '-',
    r.frames?.toString() ?? '-',
    r.durationSeconds?.toFixed(1) ?? '-',
    r.sizes || '-',
    r.tokens || '-',
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd()
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n')
}
