/*
Clip: Read Aloud Test - reads a highlighted paragraph aloud (demo-kit's own test target)
Where it plays: homepage card, 640 px wide   Length: about 16 s   Loop: yes
Build: demo-kit@HEAD, fixtures/test-page/extension (manifest 0.1.0)
Fixtures: fixtures/test-page/site served at https://demo.test   Seed: none

| # | Time   | On screen (action)                              | Cursor                                   | Camera (target, zoom)                         | Hold   |
| 1 | 0-1.5  | the article, the extension loaded               | rests in the right margin                | wide on the article column, 1.15-1.3x         | 1.5 s  |
| 2 | 1.5-5  | the second paragraph is selected by dragging    | I-beam glides to its start, drags to end | eases to 2.0x on the paragraph, follows drag  | 3 s    |
| 3 | 5-7    | "Read aloud" chip under the selection           | arrow glides down to the chip            | stays at 2.0x, pans; 2.5x as play is pressed  | press  |
| 4 | 7-9    | the player bar slides up, words light up        | 200 ms dwell, press, ripple, rests aside | settles back to 2.0x on the bar               | 1.6 s  |
| 5 | 9-12.5 | words highlight one by one as they are read     | rests in the margin                      | 2.0x on the paragraph, follows the read word  | 3.5 s  |
| 6 | end    | playback continues                              | rests                                    | pulls back to the opening framing             | 1.0 s  |

Readability check: the paragraph is 18 px Georgia; on a 640 px card at 2.0x it shows at 18 px (>= 14 px).
The player bar's 14 px label shows at 14 px at 2.0x on the card.
*/

import { offline, serveDir } from '../src/record/routes.ts'
import { defineStoryboard } from '../src/storyboard.ts'

export default defineStoryboard({
  name: 'test-page',
  title: 'Read Aloud Test reads a highlighted paragraph aloud',
  displayWidth: 640,
  accent: '#4f46e5',
  colorScheme: 'light',
  extension: {
    path: '../fixtures/test-page/extension',
    // The committed state of demo-kit itself: uncommitted changes to the extension fail pre-flight.
    expect: { repo: '..', ref: 'HEAD', forbid: ['Old Reader'] },
  },

  async setup({ context, page, resolve }) {
    await offline(context)
    await serveDir(context, 'https://demo.test', resolve('../fixtures/test-page/site'))
    await page.goto('https://demo.test/')
    await page.locator('.ra-bar').waitFor({ state: 'attached' })
  },

  async run(take, { page }) {
    await take.start({ cursor: { x: 1120, y: 300 } })
    await take.focus('page', 'body', { kind: 'context' })
    await take.wait(1500)

    await take.select('#p2', { name: 'paragraph', hold: 3 })
    await take.wait(3200)

    await take.press('.ra-chip', { name: 'play', emphasis: true })
    await page.locator('.ra-bar.is-on').waitFor()
    await take.focus('player', '.ra-bar', { kind: 'result' })
    await take.wait(500)
    await take.rest({ beside: '.ra-bar' })
    await take.wait(1900)

    await take.rest({ beside: '#p2', side: 'below' })
    await take.focus('reading', '#p2', { kind: 'read', words: 8 })
    await take.track('word', '.ra-w.ra-current', 3200)
    await take.end()
  },
})
