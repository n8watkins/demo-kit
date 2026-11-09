import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatTable, summarize, type UsageEntry } from './usage.ts'

describe('usage', () => {
  const entries: UsageEntry[] = [
    { kind: 'record', at: 'a', take: 't1', storyboard: 'test-page', wallSeconds: 21.4, frames: 300, durationSeconds: 18.2, preflight: 'passed' },
    {
      kind: 'render',
      at: 'b',
      take: 't1',
      storyboard: 'test-page',
      wallSeconds: 63.5,
      outputs: [
        {
          profile: 'desktop',
          frames: 546,
          files: [
            { file: 'desktop.mp4', bytes: 1_500_000 },
            { file: 'desktop-poster.webp', bytes: 60_000 },
          ],
        },
      ],
    },
    { kind: 'note', at: 'c', take: 't1', tokens: 'subagent: 180k tokens' },
  ]

  it('joins the record, render and note lines of a take into one row', () => {
    const [row] = summarize(entries)
    assert.equal(row.recordSeconds, 21.4)
    assert.equal(row.renderSeconds, 63.5)
    assert.equal(row.frames, 300)
    assert.equal(row.sizes, 'desktop.mp4 1.43 MB')
    assert.equal(row.tokens, 'subagent: 180k tokens')
  })

  it('prints a table', () => {
    const table = formatTable(summarize(entries))
    assert.match(table, /^take\s+record s\s+render s/)
    assert.match(table, /t1\s+21\.4\s+63\.5\s+300\s+18\.2/)
  })
})
