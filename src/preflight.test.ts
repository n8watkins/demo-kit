import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { parseExpect, passed, preflightFiles } from './preflight.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })

describe('pre-flight', () => {
  let repo: string
  let ext: string
  const manifest = (version: string, name = 'Demo') =>
    JSON.stringify({ manifest_version: 3, name, version, action: { default_title: name, default_icon: { 16: 'icons/16.png' } }, icons: { 16: 'icons/16.png' } })

  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'demo-kit-preflight-'))
    ext = join(repo, 'extension')
    mkdirSync(join(ext, 'icons'), { recursive: true })
    writeFileSync(join(ext, 'manifest.json'), manifest('1.2.0'))
    writeFileSync(join(ext, 'icons/16.png'), Buffer.from([1, 2, 3]))
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A')
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  })
  after(() => rmSync(repo, { recursive: true, force: true }))

  it('passes when the folder matches the ref', () => {
    const r = preflightFiles(ext, { repo, ref: 'HEAD' })
    assert.ok(passed(r), r.checks.map((c) => `${c.name}: ${c.detail}`).join('\n'))
    assert.equal(r.version, '1.2.0')
  })

  it('fails on a different version', () => {
    writeFileSync(join(ext, 'manifest.json'), manifest('1.1.0'))
    const r = preflightFiles(ext, { repo, ref: 'HEAD' })
    assert.ok(!passed(r))
    assert.ok(r.checks.some((c) => c.name === 'manifest version' && !c.ok))
    writeFileSync(join(ext, 'manifest.json'), manifest('1.2.0'))
  })

  it('fails on an old name', () => {
    writeFileSync(join(ext, 'manifest.json'), manifest('1.2.0', 'Old Demo'))
    const r = preflightFiles(ext, { repo, ref: 'HEAD', forbid: ['Old Demo'] })
    assert.ok(r.checks.some((c) => c.name === 'manifest name' && !c.ok))
    assert.ok(r.checks.some((c) => c.name === 'no "Old Demo"' && !c.ok))
    writeFileSync(join(ext, 'manifest.json'), manifest('1.2.0'))
  })

  it('fails on a changed icon', () => {
    writeFileSync(join(ext, 'icons/16.png'), Buffer.from([9, 9, 9]))
    const r = preflightFiles(ext, { repo, ref: 'HEAD' })
    assert.ok(r.checks.some((c) => c.name === 'icon icons/16.png' && !c.ok))
    assert.ok(r.checks.some((c) => c.name === 'files match ref' && !c.ok))
    writeFileSync(join(ext, 'icons/16.png'), Buffer.from([1, 2, 3]))
  })

  it('fails on a ref that does not resolve', () => {
    assert.ok(!passed(preflightFiles(ext, { repo, ref: 'origin/nope', fetch: false })))
  })

  it('parses --expect <repo>@<ref>', () => {
    assert.deepEqual(parseExpect('/x/voicedock@origin/main'), { repo: '/x/voicedock', ref: 'origin/main' })
    assert.deepEqual(parseExpect('/x/voicedock'), { repo: '/x/voicedock' })
  })
})
