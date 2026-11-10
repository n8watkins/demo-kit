/*
Clip: Wren - a guest asks a question and Wren answers as it writes
Where it plays: the portfolio's project card (n8watkins/dev-portfolio), about 1100 px wide, cropped to 21:9 from the top
Length: about 12 s   Loop: yes
Build: the live app, https://wren.n8builds.dev (n8watkins/wren@origin/main), guest mode, light theme
Fixtures: fixtures/wren/answer-ebike.json, one genuine answer from Wren's own model (gemini-3.5-flash-lite) with
  Wren's own system prompt, captured once on 2026-11-09 with its chunk timing, replayed for /api/guest/chat.
Seed: the "How Wren works" intro marked as seen (as Wren's own E2E suite does). No account, no personal data.

| # | Time    | On screen (action)                               | Cursor                              | Camera (target, zoom)                        | Hold  |
| 1 | 0-1.5   | the welcome screen with its suggested questions  | rests right of the suggestions      | wide on the chat column, 1.2x                | 1.5 s |
| 2 | 1.5-3.5 | the e-bike suggestion is pressed                 | glides to it, dwell, press, ripple  | eases to the suggestions, emphasised press   | press |
| 3 | 3.5-6   | the question appears and Wren's answer streams   | rests aside, out of the answer      | follows the answer as it grows               | 2.5 s |
| 4 | 6-10    | the answer's list: motor, battery, brakes        | rests                               | reads the answer's first points              | 4 s   |
| 5 | end     | the full answer                                  | rests                               | pulls back to the opening framing            | 1.0 s |

Readability check: Wren's answer is 15 px text; on an 1100 px card at the 1.2x base it shows at about 15.5 px (>= 14 px).
The card crops the 16:10 frame to 21:9 from the top, so everything that matters stays in the upper 70% of the frame.

Why the chat answer is replayed: a guest's first message on the live site runs a Cloudflare Turnstile human check,
which a recording must not get around. The page, its code and its styles are the live app; only the answer's
stream comes from the recorded fixture, served in the browser with its original timing (slowed 1.5x to read).
*/

import { readFileSync } from 'node:fs'
import { offline } from '../src/record/routes.ts'
import { defineStoryboard } from '../src/storyboard.ts'

const ORIGIN = 'https://wren.n8builds.dev'

export default defineStoryboard({
  name: 'wren',
  title: 'Wren answers a guest as it writes',
  displayWidth: 1100,
  accent: '#e2582b',
  colorScheme: 'light',

  async setup({ context, page, resolve }) {
    // Only the app itself; nothing else on the network (no Turnstile, no third parties).
    await offline(context, [ORIGIN])
    const answer = JSON.parse(readFileSync(resolve('../fixtures/wren/answer-ebike.json'), 'utf8')) as {
      prompt: string
      chunks: { t: number; text: string }[]
    }
    await page.addInitScript(
      ({ chunks }) => {
        window.localStorage.setItem('wren:seen-how-it-works', '1')
        const realFetch = window.fetch.bind(window)
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (!url.includes('/api/guest/chat') || (init?.method ?? 'GET').toUpperCase() !== 'POST') return realFetch(input, init)
          const { text } = JSON.parse(String(init?.body ?? '{}')) as { text: string }
          const now = Date.now()
          const start = {
            t: 'start',
            chat: { id: 'guest', title: text.slice(0, 60), updatedAt: now },
            userMessage: { id: 'u1', role: 'user', content: text, status: 'done', createdAt: now },
            messageId: 'a1',
            keySource: 'demo',
            usage: {
              chat: { used: 1, limit: 5 },
              voiceMinutes: { used: 0, limit: 0 },
              research: { used: 0, limit: 0 },
              resetsAt: new Date(now + 86_400_000).toISOString(),
            },
          }
          const enc = new TextEncoder()
          const line = (event: unknown) => enc.encode(`${JSON.stringify(event)}\n`)
          const body = new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(line(start))
              // The model's first text, then each chunk at its recorded time, slowed 1.5x.
              await new Promise((r) => setTimeout(r, 250))
              let last = 0
              for (const chunk of chunks) {
                await new Promise((r) => setTimeout(r, (chunk.t - last) * 1.5))
                last = chunk.t
                controller.enqueue(line({ t: 'delta', text: chunk.text }))
              }
              controller.enqueue(line({ t: 'done', status: 'done' }))
              controller.close()
            },
          })
          return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
        }
      },
      { chunks: answer.chunks },
    )
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' })
    await page.getByRole('button', { name: answer.prompt }).waitFor()
    await page.evaluate(() => document.fonts.ready)
  },

  async run(take, { page }) {
    const suggestion = page.getByRole('button', { name: /e-bike under/ })
    await take.start({ cursor: { x: 960, y: 470 } })
    // The chat column, clear of the sidebar, with the question and its suggestions in the
    // frame's top 69% (the card crops it to 21:9 from the top).
    await take.focus('welcome', { x: 295, y: 250, w: 928, h: 580 }, { kind: 'context' })
    await take.wait(2500)

    await take.press(suggestion, { name: 'ask' })
    const answer = page.getByTestId('answer').last()
    await answer.waitFor()
    await take.track('answer', answer, 2600)

    await page.waitForFunction(() => document.querySelector('[data-testid="answer"]')?.getAttribute('data-status') === 'done')
    // In the empty space after the answer's opening line, inside the reading framing.
    await take.focus('points', answer.locator('ul').first(), { kind: 'read', words: 18 })
    await take.wait(900)
    await take.rest({ x: 950, y: 118 })
    await take.wait(4600)
    // Where both the reading framing and the opening one (for the pull-back) see it.
    await take.rest({ x: 1040, y: 430 })
    await take.wait(600)
    await take.end()
  },
})
