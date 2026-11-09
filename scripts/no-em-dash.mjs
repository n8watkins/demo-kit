// Fails when an em dash appears in a tracked file (house style: a plain dash instead).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const EM_DASH = String.fromCharCode(0x2014)
const hits = []
for (const file of files) {
  if (/\.(png|jpg|jpeg|webp|ico|woff2?)$/i.test(file) || file === 'package-lock.json' || file === 'CHANGELOG.md') continue
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes(EM_DASH)) hits.push(`${file}:${i + 1}`)
    })
}
if (hits.length) {
  console.error(`em dash found:\n${hits.join('\n')}`)
  process.exit(1)
}
