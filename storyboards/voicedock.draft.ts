/*
DRAFT, NOT RECORDED. The VoiceDock pilot waits for VoiceDock's redesign (feat/design-system) to ship.
Before recording: settle the open questions below, then rename this file to voicedock.ts.

Clip: VoiceDock - reads a highlighted paragraph aloud with a natural local voice
Where it plays: n8builds.dev homepage card, 640 px wide; build page; store listing   Length: about 16 s   Loop: yes
Build: n8watkins/voicedock@origin/master, extension/ (manifest version checked by pre-flight)
Fixtures: an invented calm article served at https://demo.test (no live site)
Seed: profiles in chrome.storage.local (Kokoro "Heart" active); Piper on 127.0.0.1:7477 and Kokoro on 127.0.0.1:7478, warmed off camera

| # | Time      | On screen (action)                                   | Cursor                                    | Camera (target, zoom)                              | Hold  |
| 1 | 0-2 s     | the article, VoiceDock's current icon in place       | rests in the right margin                 | wide on the article, 1.15-1.3x                     | 1.5 s |
| 2 | 2-6 s     | the second paragraph is selected by dragging         | I-beam glides to its start, drags to end  | eases to the reading zoom on it, follows the drag  | 3 s   |
| 3 | 6-8 s     | VoiceDock's read control (see open question 1)       | arrow glides to it                        | stays zoomed, pans                                  | -     |
| 4 | 8-10 s    | play is pressed; the player bar appears, audio plays | 200 ms dwell, press, ripple, rests aside  | 2.5x as play is pressed, then back to reading zoom | 1.6 s |
| 5 | 10-14.5 s | words highlight as they are read                     | rests beside the paragraph                | reading zoom on the paragraph, follows the word    | 3.5 s |
| 6 | 14.5-16 s | playback continues                                   | rests                                     | pulls back to the opening framing                  | 1 s   |

Readability check: the article is 18 px; on a 640 px card the planner picks the zoom that shows whole lines at >= 14 px (1.76x for a 680 px column).
The player bar's labels must read at >= 14 px on the card: check their font size after the redesign; under 13 px the bar needs its own read focus.

Open questions, to settle with the owner before recording:
1. The trigger. VoiceDock starts reading from its context menu or the Alt+Shift+S command. Neither shows in a tab screencast,
   so a press would happen "by magic" (a 2026-11-09 mistake). Options: (a) the redesign adds an on-page control near the
   selection, which this draft assumes (`READ_CONTROL`); (b) demo-kit learns to show a keycap overlay for a shortcut, and the
   storyboard sends the command; (c) record the whole window under Xvfb to show the native context menu.
2. Word highlighting. Step 5 assumes the redesign highlights the word being read (`CURRENT_WORD`); if it does not, step 5
   becomes a read focus on the paragraph with no tracking, and the clip is a little shorter.
3. Audio. The clip ships silent; a version with narration audio needs demo-kit to keep the take's audio (not built yet).
*/

import { closedShadowBox, waitFor } from '../src/record/dom.ts'
import { offline, serveDir } from '../src/record/routes.ts'
import { defineStoryboard } from '../src/storyboard.ts'

/** TODO after the redesign: the class of the on-page read control and of the highlighted word (closed shadow root). */
const READ_CONTROL = 'read-control'
const CURRENT_WORD = 'word-current'
const PLAYER_BAR = 'bar'

export default defineStoryboard({
  name: 'voicedock',
  title: 'VoiceDock reads a highlighted paragraph aloud with a natural local voice',
  displayWidth: 640,
  // VoiceDock's accent (Catppuccin mauve, from its player bar).
  accent: '#cba6f7',
  colorScheme: 'light',
  extension: {
    path: '~/projects/extensions/voicedock/extension',
    // Piper TTS was VoiceDock's name up to 1.0.17.
    expect: { repo: '~/projects/extensions/voicedock', ref: 'origin/master', forbid: ['Piper TTS'] },
  },

  async setup({ context, page, worker, resolve }) {
    // Local voices only; everything else is refused.
    await offline(context, ['http://127.0.0.1:7477', 'http://127.0.0.1:7478'])
    await serveDir(context, 'https://demo.test', resolve('../fixtures/test-page/site'))
    await worker?.evaluate(() =>
      chrome.storage.local.set({
        profiles: [
          { id: 'stories', name: 'Stories', engine: 'kokoro', voice: 'af_heart', rate: 1.0, volume: 1 },
          { id: 'articles', name: 'Articles', engine: 'piper', voice: 'en_US-ryan-high.onnx', rate: 1.1, volume: 1 },
        ],
        activeId: 'stories',
      }),
    )
    // Warm both engines so the take never waits on a model load.
    for (const [port, voice] of [
      [7477, 'en_US-ryan-high.onnx'],
      [7478, 'af_heart'],
    ] as const) {
      await fetch(`http://127.0.0.1:${port}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Warm up.', voice }),
      }).catch(() => {
        throw new Error(`the local voice on port ${port} is not running`)
      })
    }
    await page.goto('https://demo.test/')
  },

  async run(take, { page }) {
    await take.start({ cursor: { x: 1120, y: 300 } })
    await take.focus('page', 'body', { kind: 'context' })
    await take.wait(1500)

    await take.select('#p2', { name: 'paragraph', hold: 3 })
    await take.wait(2400)

    const control = await waitFor(() => closedShadowBox(page, READ_CONTROL))
    await take.press(control, { name: 'read', emphasis: true })
    const bar = await waitFor(() => closedShadowBox(page, PLAYER_BAR))
    await take.focus('player', bar, { kind: 'result' })
    await take.wait(500)
    await take.rest({ beside: bar })
    await take.wait(1900)

    await take.rest({ beside: '#p2', side: 'below' })
    await take.focus('reading', '#p2', { kind: 'read', words: 8 })
    // The word being read, polled through the closed shadow root.
    const end = Date.now() + 3200
    while (Date.now() < end) {
      const word = await closedShadowBox(page, CURRENT_WORD)
      if (word) await take.track('word', word, 100)
      else await take.wait(100)
    }
    await take.end()
  },
})

declare const chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } }
