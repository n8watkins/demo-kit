# demo-kit

Record polished product demo clips from a script: the real product, a calm camera that zooms to what matters, a large cursor and a ripple on every click.

demo-kit drives the product with Playwright, logs everything it does, plans a camera from that log, and renders the clip with Remotion.
One storyboard file per product; the same pipeline for n8builds.dev cards, build pages, store listings and READMEs.

```
storyboard.ts --record--> take.json + frames (2560x1600) --plan--> camera path --render--> desktop 1280x800 + phone 390x760
                                                                                            .mp4  .webm  -poster.webp
```

The rules it follows (zoom levels, holds, cursor, review checklist) are the [demo-recording playbook](https://github.com/n8watkins/dotfiles/blob/main/skills/demo-recording/SKILL.md).

## Quick start

Needs Node 24 or newer, `ffmpeg` with libx264, libvpx-vp9 and libwebp (Ubuntu's `ffmpeg` package has all three), and Linux or macOS.

```bash
git clone https://github.com/n8watkins/demo-kit && cd demo-kit
npm ci
npx playwright install chromium    # the browser that records
npm link                           # optional: puts `demo-kit` on your PATH (or use `node bin/demo-kit.mjs`)

demo-kit record storyboards/test-page.ts
demo-kit render takes/test-page-<stamp>
demo-kit usage
```

The first render downloads Remotion's headless Chrome (about 100 MB) once.
The clip lands in `takes/test-page-<stamp>/out/`: `desktop.mp4`, `desktop.webm`, `desktop-poster.webp` and the same for `phone`.

`storyboards/test-page.ts` is the built-in test target: an invented article served from `fixtures/test-page/site` and a tiny "Read Aloud Test" extension (`fixtures/test-page/extension`) that adds a read-aloud chip and a player bar.
It exercises every feature: extension loading, pre-flight, a text selection, the readable zoom, follow-pan, a pressed button with a ripple, a result appearing, word-by-word tracking and the pull-back.

Remotion is free for individuals and for companies of up to 3 people; a larger company needs a [Remotion company license](https://www.remotion.dev/license).
Re-check this if that changes.

## Commands

| Command | What it does |
| --- | --- |
| `demo-kit record <storyboard.ts> [--expect <repo>@<ref>] [--skip-preflight] [--headed] [--out <dir>]` | Pre-flight, then records the take into `takes/<name>-<stamp>/` (`take.json` and `frames/`). |
| `demo-kit render <take-dir> [--only desktop\|phone] [--concurrency <n>]` | Plans the camera for each cut, renders it and encodes the web files into `<take>/out/`. A re-render needs no re-take. |
| `demo-kit plan <take-dir> [--strict]` | Prints both camera plans and the planner's warnings, in a second: use it to tune a storyboard's timing. `--strict` exits 1 when the desktop plan warns. |
| `demo-kit preflight --ext <dir> --expect <repo>@<ref> [--forbid <word>]...` | The build check on its own; exits 1 on a mismatch. |
| `demo-kit usage [--json]` | A table of every take: record and render wall time, frames, clip length, file sizes, AI tokens. |
| `demo-kit usage note <take> --tokens "<text>"` | Adds the AI token usage of the session that made a take. |

`npm test` runs the unit tests (the camera planner, pre-flight, usage), `npm run lint` runs Biome and `npm run typecheck` runs tsc.

## Writing a storyboard

A storyboard is one file in `storyboards/`.
Start with the playbook's storyboard table as the file's header comment, then the script.

```ts
import { offline, serveDir } from '../src/record/routes.ts'
import { defineStoryboard } from '../src/storyboard.ts'

export default defineStoryboard({
  name: 'my-product',
  title: 'My Product reads a highlighted paragraph aloud',
  displayWidth: 640, // where the desktop cut is shown: the readable zoom depends on it
  accent: '#4f46e5', // the click ripple's colour
  extension: {
    path: '~/projects/extensions/my-product/extension',
    expect: { repo: '~/projects/extensions/my-product', ref: 'origin/main', forbid: ['Old Name'] },
  },
  async setup({ context, page, worker, resolve }) {
    // Off camera: no live network, fixtures, seeded storage, the page opened.
    await offline(context)
    await serveDir(context, 'https://demo.test', resolve('../fixtures/my-product'))
    await page.goto('https://demo.test/')
  },
  async run(take) {
    await take.start({ cursor: { x: 1120, y: 300 } })
    await take.focus('page', 'body', { kind: 'context' })
    await take.wait(1500)
    await take.select('#p2', { hold: 3 })
    await take.press('.read-button', { emphasis: true })
    await take.end()
  },
})
```

### The take API

| Call | What it does |
| --- | --- |
| `start({ cursor })` | Starts the screencast; the cursor appears at `cursor`. |
| `focus(name, target, { kind, fontPx, words, hold, emphasis })` | Tells the camera what to look at. `kind`: `context` (a whole area, the wide framing), `read` (text to read, zoomed until readable), `action` (a control, capped near 1.6x), `result` (what appeared). Font size and word count are read from the page when not given. |
| `select(target, { hold })` | Glides an I-beam to the start of the element's text and drags to its end, for real; logs a `read` focus. |
| `press(target, { emphasis, frame })` | Logs an `action` focus, glides there, dwells 200 ms, clicks for real and holds 300 ms. `emphasis` zooms to 2.5x for the key moment. |
| `glide(target, { ms })` | Moves the real mouse along an eased, slightly arced path, 400-1100 ms by distance. |
| `rest(point \| { beside, side })` | Moves the cursor out of the way but inside the shot: beside a target (`right`, or `below` for text that fills the frame). The camera never follows it. |
| `track(name, target, ms)` | Samples an element's box every 100 ms (a word being read) so the camera follows it. |
| `wait(ms)`, `hold(ms)` | Waits; `hold` also logs it. |
| `cut(async () => ...)` | Runs a slow step (a page load, a warm-up) and cuts it from the take. |
| `poster()` | Marks the poster frame (default: a second after the last result appeared). |
| `end()` | Logs the end and records 2.6 s more for the pull-back and its hold. |

Targets are Playwright locators, CSS selectors, boxes or points, in CSS px of the 1280x800 viewport.
For an element in a closed shadow root, `closedShadowBox(page, className)` from `src/record/dom.ts` finds its box through the DevTools protocol, and the real mouse presses it there.

Network helpers in `src/record/routes.ts`: `offline(context, allow)` refuses every request no fixture answers (allow local services such as `http://127.0.0.1:7477`), `serveDir` serves a folder at an origin, `replay` answers a URL with a recorded reply, `replayHar` replays a HAR file.
Replies must be genuine responses captured once from the real service.

`storyboards/voicedock.draft.ts` is a fuller example, with the open questions for the VoiceDock pilot.

## Pre-flight

A take of an extension is refused unless the folder Chrome loads matches a git ref of its repo: the manifest's name, version and action title, every icon byte for byte, every file when the folder is tracked, and no forbidden old names.
Inside the browser it checks again that `chrome.runtime.getManifest()` and the served icons match that folder.

```bash
demo-kit record storyboards/my-product.ts --expect ~/projects/extensions/my-product@origin/main
```

`--expect` overrides the storyboard's `extension.expect`; a remote ref is fetched first.
`--skip-preflight` records anyway, and the take and its usage row say it was not checked.
A build folder (`dist/`, not tracked) gets the manifest and icon checks only, so rebuild it right before recording.

## The camera

The planner (`src/camera/plan.ts`, pure and unit-tested) turns the take's log into one framing per output frame.
It implements the playbook's camera rules:

- the wide framing at 1.15-1.3x on the context area, never 1.0x;
- readable text: at least 14 px tall where the clip is shown, 2.0-2.5x, chosen from the font size and `displayWidth`;
- controls framed with their surroundings, capped near 1.6x; an emphasised press goes to 2.5x and settles back after;
- a near target is panned to at the current zoom instead of pulling back;
- every move eased (smootherstep), one at a time, 0.7-1.0 s for a pan and 0.9-1.3 s for a zoom;
- still from 300 ms before each press to 300 ms after it; the move into a control starts early to make that happen;
- holds of at least 1.5 s on a focus, 250 ms per word to read, 1.0 s on a control;
- follow-pan while zoomed when the cursor or a tracked element leaves the middle 60% of the frame;
- the pull-back to the opening framing at the end, so the loop seam crossfades between matching shots.

It adds a few refinements found while building the test clip:

- when a whole text block fits at a smaller zoom that is still readable, it uses that one, so no line is cut at the edge (an 18 px, 680 px column on a 640 px card reads at 1.76x);
- edge snapping: each framing is nudged up or down so the frame's top and bottom edges fall between text lines, not through them, and no stray sliver of a line sits in a corner;
- a cursor that is resting (or still) never pulls the camera; follow pans only move along the axis the subject left, and skip nudges under 30 px.

The phone cut (390x760) is planned from the same take with its own ranges: it always fills the portrait frame and keeps text at 14 px or more on a 390 px screen.

`demo-kit plan <take>` prints the moves and warnings: a hold cut short by a press, a move that starts late because of a hold, a pull-back without room, the cursor out of frame.
Fix the storyboard's waits until the desktop plan has no warnings.

## Usage tracking

Every `record` and `render` appends a line to `usage.jsonl` (in this repo, committed with the clip's pull request): the storyboard, the take, wall time, frames, clip length, preflight result and output sizes.
`demo-kit usage` prints one row per take.

AI token usage is not visible to the CLI, so the orchestrating agent adds it.
When an agent hands a recording to a subagent, the subagent's completion shows its totals (tokens, tool uses, duration); the orchestrator then runs:

```bash
demo-kit usage note test-page-20261109-180619 --tokens "subagent: 182k tokens, 96 tool uses, 31 min"
```

When the orchestrator recorded the take itself, it notes what it can see of its own session, or "not visible".
The field is free text: it is for knowing what a clip cost, not for optimising.

## The take folder

| File | What it is |
| --- | --- |
| `take.json` | The log: viewport, scale, duration, frames (time and file), events (cursor, press, focus, track, layout, end), the pre-flight report. |
| `frames/` | The screencast frames, 2560x1600 JPEG, at the times in `take.json`. |
| `camera-desktop.json`, `camera-phone.json` | The camera plans: moves, one framing per frame, warnings. |
| `master-desktop.mp4`, `master-phone.mp4` | The rendered masters (high quality, before the loop seam). |
| `out/` | The web files: `.mp4` (H.264), `.webm` (VP9), `-poster.webp`, no audio track. |

Keep the take folder with the clip's notes: a review note becomes a re-render, not a re-take.

## Troubleshooting

- **Frames are 1280 wide, or images look soft.** The recorder needs both `deviceScaleFactor: 2` and `--force-device-scale-factor=2` (`src/record/launch.ts`); with one alone the screencast is 1280x800 or the page reports devicePixelRatio 1.
- **The extension does not load.** The take runs Playwright's full Chromium (`channel: 'chromium'`), because the headless shell cannot load extensions; run `npx playwright install chromium`.
- **Pre-flight fails.** Read the failing line: check out the default branch, pull, rebuild a build folder, or pass the right `--expect`. Never `--skip-preflight` for a clip that ships.
- **`demo-kit plan` warns.** Add or lengthen `take.wait()` calls where it says; a `rest` keeps the cursor in the shot.
- **A step stalls for 30 s.** A Playwright call is waiting for an element that never appears; `track` and `box` use short timeouts, so check custom code in the storyboard.
- **The first render downloads Chrome.** Remotion fetches its headless shell once into `node_modules/.remotion`.
- **ffmpeg: Unknown encoder.** Install an ffmpeg with libx264, libvpx-vp9 and libwebp.
- **Files are too big.** Shorten the clip, or raise the CRFs in `src/render/encode.ts` (MP4 26, WebM 41).

## Known limits

- The phone cut is a crop of the 1280x800 take: lines of a wide text column are cut at the sides (the reading start is kept in view). For a real narrow layout, record a separate take with `viewport: { width: 390, height: 760 }` and `outputs: ['phone']`.
- A tab screencast cannot see the toolbar, the real action popup, context menus or keyboard shortcuts; a story that needs them needs a whole-window recording under Xvfb, which is not built yet.
- The page must not scroll during a take: boxes are logged in viewport coordinates and the camera does not track scrolling.
- Clips are silent; keeping narration audio is not built yet.
- The screencast sends a frame only when the page repaints (about 20-30 fps on a calm page), so fast in-page animations look as smooth as Chromium painted them, not smoother.
- Extension network requests made from the service worker may bypass Playwright's routes; prefer local services on the allow list.

## License

MIT, see [LICENSE](LICENSE).
Remotion, which renders the clips, has its own license: free for individuals and companies of up to 3 people.
