# Commercials: implementation plan

Status: plan, not built; reviewed 2026-11-10 (final review: cost guard, licences, milestone order).
Written 2026-11-10 from the commercial-readiness audit (https://claude.ai/artifact/L3fTaUK5ah6LhqFXyQtqeP) and the code at `main`.
Nothing here changes the demo path.

## 1. Goals and non-goals

### Goals

- Add a second output type, the **commercial**: a 15 to 60 second video with several scenes, title cards, voice-over, music, sound effects and captions, built on the same engine as the demos (real recorded takes, the camera planner, `Clip`, Remotion).
- Reuse recorded takes without re-recording: a script change or an audio change is a re-render, not a re-take.
- Render one script into several aspect ratios (16:9, 9:16, 1:1), each with its own camera plan.
- Cost nothing, as a rule: **never pay**.
  demo-kit makes **no paid or metered API calls**: not for voice, not for music, not for anything else.
  Voice-over is free, local, open-source text to speech; everything runs on this machine or in GitHub Actions on this public repo (free minutes).
- Keep Claude's token use low: Claude never receives video or audio.
  Code measures what can be measured, Claude looks at a few still frames, and the owner watches the final cut.
- Track the licence of every audio asset in a manifest, and block a public release until each one is cleared.
- Close the existing test gap: the render path has no tests today.

### Non-goals

- **Demos stay silent.**
  `demo-kit render` keeps `muted: true`, its two profiles (`desktop`, `phone`), its loop seam and its outputs exactly as they are.
  Commercial code lives in new modules and a new composition; the only edits to existing files are additive (see section 3.2).
- No paid or metered service of any kind: no paid TTS, no paid music library, no stock video, and **no Cloudflare Workers AI** (or any other metered API) for voice or anything else in demo-kit.
  The Cloudflare account is on Workers Paid, where use past the free 10,000 neurons a day is billed; keeping demo-kit out of it entirely is what makes the rule easy to hold.
- No sending video or audio to Claude, and no per-frame image review.
- No in-browser video editor, no timeline UI, no live preview server beyond Remotion's own.
- No whole-window or desktop recording (a known limit of the recorder, unrelated to this work).
- No speech-to-text for captions in the first version: caption timing comes from the voice line timings.
- No automatic publishing to any platform.

## 2. The commercial script format

One TypeScript file per commercial, in `commercials/<id>/commercial.ts`, next to the existing `storyboards/` convention.
It is data only, validated at load time; it contains no recording logic (takes come from storyboards).

### 2.1 Types

```ts
// src/commercial/types.ts
export type Aspect = '16:9' | '9:16' | '1:1'

export interface Commercial {
  /** Folder name under commercials/ and the prefix of output files. */
  id: string
  title: string
  /** Seconds. The build fails if the final length misses this by more than the check tolerance. */
  targetSeconds: number
  /** Which cuts to build. Each gets its own camera plan and its own files. */
  aspects: Aspect[]
  brand: Brand
  voice: VoiceConfig
  music?: MusicConfig
  sfx?: SfxConfig
  captions: CaptionConfig
  scenes: Scene[]
}

export interface Brand {
  name: string
  /** Hex colours. `accent` is also the click ripple colour of take scenes. */
  background: string
  foreground: string
  accent: string
  /** A Google Fonts family (open licence), loaded with @remotion/google-fonts. */
  font: string
  /** Optional logo, a path under commercials/<id>/assets/ (SVG or PNG). */
  logo?: string
}

export interface VoiceConfig {
  provider: 'kokoro' | 'piper'
  /** Kokoro: a voice id such as 'af_heart'. Piper: a voice name such as 'en_US-lessac-medium'. */
  speaker: string
  /** Words per minute target used only to estimate length before any audio exists (default 150). */
  wpm?: number
}

export interface MusicConfig {
  /** A path under commercials/<id>/assets/, listed in licenses.json. */
  file: string
  /** Gain with no voice playing, in dB relative to full scale (default -20). */
  bedDb?: number
  /** Gain under the voice, in dB (default -30). */
  duckedDb?: number
  /** Seconds to fade in at the start and out at the end (default 0.5 and 1.5). */
  fadeIn?: number
  fadeOut?: number
}

export interface SfxConfig {
  /** A soft click at every press in the take scenes (default true). */
  clicks?: boolean
  /** A short whoosh on each transition (default true). */
  whoosh?: boolean
  /** dB relative to full scale (default -24). */
  db?: number
}

export interface CaptionConfig {
  burnIn: boolean
  /** Also write an .srt next to each video. */
  srt: boolean
  /** Position of burned-in captions (default 'bottom'). */
  position?: 'bottom' | 'top'
}

export interface VoiceLine {
  /** Unique within the commercial; also the cache key's readable half. */
  id: string
  /** The words spoken and the words captioned. Plain text, no SSML. */
  text: string
  /** Seconds after the scene starts that the line begins (default 0.3). */
  offset?: number
  /** Override the commercial's speaker for this line. */
  speaker?: string
}

export type Transition = 'cut' | 'fade' | { slide: 'left' | 'right' | 'up' | 'down' } | 'wipe'

interface SceneBase {
  id: string
  /** The transition into this scene (the first scene's is ignored). Default 'fade'. */
  transition?: Transition
  /** Transition length in seconds (default 0.4). */
  transitionSeconds?: number
  lines?: VoiceLine[]
  /**
   * Scene length. `'voice'` means: the end of the last line plus `tail`, but never shorter than `min`.
   * A number is fixed seconds. Take scenes default to `'voice'` bounded by the take window.
   */
  seconds?: number | 'voice'
  tail?: number
  min?: number
}

/** A full-frame text card: a headline and an optional subline over the brand background. */
export interface CardScene extends SceneBase {
  kind: 'card'
  headline: string
  sub?: string
  /** Default 'rise': the headline fades and rises 24 px. */
  animation?: 'rise' | 'type' | 'none'
}

/** A window of a recorded take, framed by a camera plan made for the output aspect. */
export interface TakeScene extends SceneBase {
  kind: 'take'
  /** Which recorded take to use for each aspect. A take recorded at a phone viewport is needed for a real 9:16. */
  take: Partial<Record<Aspect, TakeRef>>
  /** The part of the take to show, in take seconds (default: all of it). */
  window?: { from: number; to: number }
  /** Burned-in lower label such as a product name (not a caption). */
  label?: string
}

export interface TakeRef {
  /** The storyboard name, as in `takes/<storyboard>-<stamp>`. */
  storyboard: string
  /** 'latest' resolves to the newest matching folder and is written into commercial.lock.json. */
  take: 'latest' | string
}

/** The closing card: logo, a line, and a call to action (a URL or a name). */
export interface OutroScene extends SceneBase {
  kind: 'outro'
  headline: string
  cta: string
}

export type Scene = CardScene | TakeScene | OutroScene
```

Rules enforced when the script loads:

- Scene ids and line ids are unique.
- Every take scene names a take for every aspect in `aspects`.
- A line must fit its scene, or the scene length is `'voice'`.
- Captions text is the line text; there is no separate caption text, so captions can never drift from the voice.
- `music.file` and every asset must have an entry in `licenses.json` (see 4.2).

### 2.2 Example: 15 second pipeline test

The first commercial exists only to prove the pipeline end to end on the built-in test target.
It needs no new recording.

```ts
// commercials/pipeline-test/commercial.ts
import { defineCommercial } from '../../src/commercial/define.ts'

export default defineCommercial({
  id: 'pipeline-test',
  title: 'Pipeline test: Read Aloud Test',
  targetSeconds: 15,
  aspects: ['16:9', '1:1'],
  brand: { name: 'Read Aloud Test', background: '#0f1115', foreground: '#f4f4f5', accent: '#4f46e5', font: 'Figtree' },
  voice: { provider: 'kokoro', speaker: 'TBD-after-audition' },
  music: { file: 'music/bed.mp3' },
  sfx: { clicks: true, whoosh: true },
  captions: { burnIn: true, srt: true },
  scenes: [
    {
      kind: 'card',
      id: 'hook',
      headline: 'Long articles, read to you.',
      lines: [{ id: 'hook', text: 'Long article? Let it read itself to you.' }],
    },
    {
      kind: 'take',
      id: 'demo',
      take: {
        '16:9': { storyboard: 'test-page', take: 'latest' },
        '1:1': { storyboard: 'test-page', take: 'latest' },
      },
      window: { from: 1.5, to: 9 },
      lines: [
        { id: 'select', text: 'Select a paragraph.', offset: 0.6 },
        { id: 'play', text: 'Press play, and follow along word by word.', offset: 3.2 },
      ],
    },
    {
      kind: 'outro',
      id: 'outro',
      headline: 'Read Aloud Test',
      cta: 'n8builds.dev',
      lines: [{ id: 'cta', text: 'Read Aloud Test. Built by n8builds.' }],
    },
  ],
})
```

This is about 140 characters of speech: roughly 10 seconds of audio, a few seconds of local synthesis.

### 2.3 Example: 30 second n8builds reel

Wren has a storyboard today (`storyboards/wren.ts`).
NetTrailers and PortfolioRank need storyboards and takes first (milestone M7), after the portfolio refresh; the `take` names below are the storyboard names they will use.
The voice lines are draft copy for the owner to approve; they make no claims beyond what each product's own page says.

```ts
// commercials/n8builds-reel/commercial.ts
import { defineCommercial } from '../../src/commercial/define.ts'

const both = (storyboard: string) => ({ '16:9': { storyboard, take: 'latest' as const }, '9:16': { storyboard: `${storyboard}-mobile`, take: 'latest' as const } })

export default defineCommercial({
  id: 'n8builds-reel',
  title: 'n8builds reel: Wren, NetTrailers, PortfolioRank',
  targetSeconds: 30,
  aspects: ['16:9', '9:16'],
  brand: { name: 'n8builds', background: '#0b0c10', foreground: '#f5f5f4', accent: '#4f46e5', font: 'Figtree', logo: 'assets/n8builds.svg' },
  voice: { provider: 'kokoro', speaker: 'TBD-after-audition' },
  music: { file: 'music/reel-bed.mp3', bedDb: -20, duckedDb: -30 },
  sfx: { clicks: true, whoosh: true },
  captions: { burnIn: true, srt: true },
  scenes: [
    { kind: 'card', id: 'hook', headline: 'Small tools. Real ones.', seconds: 3, lines: [{ id: 'hook', text: 'Small tools, built to be used.' }] },
    { kind: 'take', id: 'wren', take: both('wren'), window: { from: 0, to: 7 }, label: 'Wren',
      lines: [{ id: 'wren', text: 'Wren answers your guests while you do something else.' }] },
    { kind: 'take', id: 'nettrailers', take: both('nettrailers'), window: { from: 0, to: 7 }, label: 'NetTrailers',
      lines: [{ id: 'nt', text: 'NetTrailers puts the trailer where you are already looking.' }] },
    { kind: 'take', id: 'portfoliorank', take: both('portfoliorank'), window: { from: 0, to: 7 }, label: 'PortfolioRank',
      lines: [{ id: 'pr', text: 'PortfolioRank shows how your projects stack up.' }] },
    { kind: 'outro', id: 'outro', headline: 'n8builds', cta: 'n8builds.dev', seconds: 4, lines: [{ id: 'cta', text: 'See them all at n8builds dot dev.' }] },
  ],
})
```

Notes on the example:

- The windows are placeholders; real windows are set after the takes exist and `commercial plan` has printed the voice and take lengths.
- `wren-mobile` style storyboards are the phone-sized recordings a true 9:16 needs (section 3.4).
- Product lines are draft copy; the owner approves the words at M7 before any voice is generated for them.

## 3. Architecture

### 3.1 Module map

New code lives in `src/commercial/`.
Nothing in `src/record/`, `src/camera/` or the demo CLI branches is reorganised.

| Path | Role |
| --- | --- |
| `src/commercial/types.ts`, `define.ts`, `load.ts` | The types above, `defineCommercial()` (identity helper with the same role as `defineStoryboard`), and a loader that imports a script and validates the rules in 2.1. |
| `src/commercial/profiles.ts` | Output profiles per aspect, built on the existing `Profile` type from `src/camera/plan.ts` (1920x1080, 1080x1920, 1080x1080). |
| `src/commercial/lock.ts` | Resolves `take: 'latest'` to a folder and writes `commercials/<id>/commercial.lock.json` (take folder names plus the SHA-256 of each `take.json`). Builds use the lock, so a later recording never silently changes a finished commercial. |
| `src/commercial/audio/tts.ts` | The `TtsProvider` interface, the per-line cache, and the local-only rule (section 4.1). |
| `src/commercial/audio/kokoro.ts`, `piper.ts` | The two local providers (subprocesses). |
| `src/commercial/audio/sfx.ts` | Generates click and whoosh WAVs from code (section 4.3). |
| `src/commercial/audio/duck.ts` | Pure function: voice spans in, a gain envelope out (section 3.7). |
| `src/commercial/timeline.ts` | Pure function: script plus measured line durations plus take windows in, a timeline out: each scene's start and length in frames, transitions, line start times, press times for clicks. Everything downstream reads this one structure. |
| `src/commercial/captions.ts` | Cues from the timeline, SRT writer (section 3.8). |
| `src/commercial/remotion/index.tsx`, `Commercial.tsx`, `CardScene.tsx`, `OutroScene.tsx`, `Captions.tsx` | A separate Remotion root with one composition, `Commercial`. The demo root (`src/render/remotion/index.tsx`) is not touched. |
| `src/commercial/render.ts` | `renderCommercial()`: bundle, render per aspect, normalise, encode. |
| `src/commercial/normalise.ts` | Two-pass `loudnorm` with `ffmpeg` (section 3.9). |
| `src/commercial/encode.ts` | The web encodes (section 3.10). |
| `src/commercial/check/` | One file per check, `report.ts` for the JSON shape, `stills.ts` (section 5). |
| `src/commercial/licenses.ts` | Reads and validates `licenses.json` (section 4.2). |

Per-commercial files:

```
commercials/<id>/
  commercial.ts            the script (committed)
  commercial.lock.json     resolved takes and their hashes (committed)
  licenses.json            the asset manifest (committed)
  assets/                  music, logo, fonts if any (audio files gitignored, manifest committed)
  audio/                   scratch voice lines and generated SFX (gitignored)
  voice/                   the approved voice lines of a finished commercial, small mp3s (committed, so Actions can render without TTS)
  out/                     renders, encodes, check report, stills (gitignored)
```

`.gitignore` gains `commercials/*/audio/`, `commercials/*/out/` and `commercials/*/assets/**/*.{mp3,wav,ogg}`.

### 3.2 The CLI

`demo-kit commercial <subcommand>` is added as one new `case 'commercial'` in `src/cli.ts`, delegating to `src/commercial/cli.ts` so the demo commands stay as they are.

| Subcommand | What it does | Cost |
| --- | --- | --- |
| `commercial setup-voice [--provider kokoro\|piper]` | Installs the voice program and model once from a pinned source, with a recorded SHA-256 (section 4.1). | None |
| `commercial audition [--provider kokoro\|piper]` | Synthesizes the same two fixed sentences in each candidate voice locally into `commercials/_audition/`, named by provider and voice, and prints the paths so the owner can play them and pick one. | None (local CPU) |
| `commercial plan <id>` | Dry run: validates the script, resolves the lock, prints the timeline and the estimated voice length from `wpm`. Makes no audio and no render. | None |
| `commercial voice <id>` | Synthesizes missing voice lines only, locally, measures each with `ffprobe`, writes `audio/lines.json`. Refuses `speaker: 'TBD-after-audition'`. | None (local CPU) |
| `commercial render <id> [--aspect <a>] [--only-scene <id>] [--concurrency <n>]` | Builds the timeline from measured lengths, renders each aspect, normalises and encodes. | None |
| `commercial check <id> [--aspect <a>] [--release]` | Runs every check and writes `out/check.json` (section 5). `--release` also requires every licence cleared. Exit code 1 on any failed check. | None |
| `commercial stills <id> [--scenes a,b]` | Writes three stills per scene (section 5.4). | None |
| `commercial build <id>` | `voice`, `render`, `check`, `stills` in order, stopping at the first failure. | As above |

Edits to existing files, all additive:

- `src/cli.ts`: the new `case` and a line in `HELP`.
- `src/render/remotion/Clip.tsx`: one optional prop, `startAt?: number` (seconds into the take, default 0), added to `t = frame / p.fps + (p.startAt ?? 0)` and to the sample index. Demo renders never set it.
- `src/render/encode.ts`: export the existing private `ffmpeg` helper.
- `src/usage.ts`: a new `UsageEntry` kind `commercial` so `demo-kit usage` also tracks commercial builds (wall time, output sizes).

The demo `render` branch, `renderTake`, the `Clip` default behaviour and `muted: true` are unchanged.

### 3.3 How scenes reuse takes and `Clip`

- A **take scene** renders `Clip` inside a `Sequence`, with the scene's camera plan and `startAt = window.from`.
  The scene length in frames is `window.to - window.from` unless a voice line needs more, in which case the build fails with a message (it never stretches or slows a take).
- `clipProps(log, plan, profile)` from `src/render/render.ts` builds the props.
  The commercial passes a commercial profile (1920x1080 and so on) and a plan made for it.
- `Clip` already draws the cursor and ripples in output pixels, so they stay crisp at 1080p.
  `cursorPx` is set per commercial profile.
- A **card scene** and an **outro scene** are plain React components using the brand tokens and `@remotion/google-fonts`.
  Text is measured with `@remotion/layout-utils` (pinned to Remotion's version, 4.0.542) so the safe-area check can use real boxes.
- Scenes are joined by `TransitionSeries` from `@remotion/transitions` (also pinned to 4.0.542), with `fade`, `slide` and `wipe` presentations.
  A transition overlaps its neighbours, so the timeline subtracts the overlap from the total length; `timeline.ts` owns that arithmetic and has unit tests.

### 3.4 Per-aspect camera re-planning

- `planCamera(log, profile)` is pure and takes a `Profile`, so each aspect gets its own plan from the same `take.json`.
  `src/commercial/profiles.ts` defines three profiles with the ranges tuned for the output size and for where the video is shown (`displayWidth`).
- The planner's zoom ranges are relative to the take's CSS pixels and to `displayWidth`, so the 1080p profiles must be calibrated, not copied from `DESKTOP`.
  Calibration is an explicit task in M2: render the test page at each profile and check the planner warnings and the safe-area check.
- **16:9** uses the normal 1280x800 desktop take: the 16:10 take is framed into a 16:9 window (the planner already supports a window narrower than the viewport).
- **1:1** uses the same take framed into a square window.
- **9:16 needs a phone-sized take.**
  Cropping the desktop take cuts text columns (a known limit in the README).
  A reel with 9:16 therefore needs a second storyboard per product that records at `viewport: { width: 390, height: 760 }`, with `outputs: ['phone']`, and the script names it in the `take` map.
  If a 9:16 take is missing, `commercial plan` fails and says which storyboard to record; it never falls back to the crop.
- Camera plans are written to `commercials/<id>/out/camera-<scene>-<aspect>.json` for inspection with the same warning format as `demo-kit plan`; any planner warning is a `warn` in the check report.

### 3.5 Timeline and pacing

Voice length drives pacing, so audio is produced before the render:

1. `commercial voice` makes every missing line and records its measured duration.
2. `timeline.ts` computes each scene's length: for `'voice'` scenes, `max(min, lastLineEnd + tail)` where a line ends at `offset + duration`; for fixed scenes, the number given (the load step fails if a line does not fit).
3. Take windows are checked against scene length: a window shorter than the scene fails the build, a longer one is trimmed at its end.
4. The sum of scene lengths minus transition overlaps is compared with `targetSeconds`; the plan output prints the gap so the owner or Claude edits words, windows or `tail`, not code.

### 3.6 Audio in the composition

Remotion's `<Audio>` plays each track; the composition holds three layers:

- **Voice:** one `<Audio src={staticFile(line.file)}>` per line inside a `Sequence` at the line's start frame.
- **Music:** one `<Audio>` over the whole commercial, trimmed to length, with the `volume` callback below.
- **SFX:** one short `<Audio>` per click or transition, at the frame computed in the timeline.
  Click times come from the take's `press` events, shifted by the scene start and the window offset, and dropped if outside the window.

Audio files are served the same way as take frames: the bundle's `publicDir` is the commercial's folder, as `renderTake` does with the take folder.

### 3.7 Ducking from VO timings

`duck.ts` exports a pure `duckGain({ frame, fps, spans, bedDb, duckedDb, attack, release }): number`.
`spans` are the voice line intervals from the timeline, padded by 120 ms on each side.
The gain is the bed level, eased down to the ducked level over `attack` (default 0.15 s) when a span starts and back up over `release` (default 0.5 s) when it ends, with overlapping spans merged.
Music `volume` is `(frame) => duckGain(...) * fadeEnvelope(frame)`.
No audio analysis is needed because the voice timings are known exactly.
Unit tests cover: no spans, one span, two spans closer than the release time, a span at frame 0, and monotonic ramps.

### 3.8 Captions from the VO script

- A cue is built from each voice line: start is the line start, end is the line end.
- Long lines are split at punctuation, then at the word nearest the middle, to at most two lines of 42 characters.
  Split cues divide the line's time in proportion to character count.
  This is an estimate of word timing, good to a few hundred milliseconds; it is acceptable because the line start and end are exact.
  If the owner finds it visibly off, the upgrade is word timestamps from a local forced alignment of the cached lines (see the open questions); nothing metered is ever called.
- The burned-in version is a React component over the `TransitionSeries`, so captions are not faded by transitions.
- The SRT is written from the same cues, one file per aspect.
- Captions never contain text that is not spoken, so reading speed and sync are fully checkable from the cues.

### 3.9 Loudness normalisation after render

`normalise.ts` runs after Remotion has produced `master-<aspect>.mp4`:

1. Pass 1: `ffmpeg -i master -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -` and parse the measured values.
2. Pass 2: `loudnorm` with `measured_I`, `measured_TP`, `measured_LRA`, `measured_thresh`, `offset`, `linear=true`, the video stream copied (`-c:v copy`), audio re-encoded to AAC 192k.
3. Verify with `ebur128` (this is what `commercial check` reads, so the number reported is a second, independent measurement).

The pass-2 true-peak target is -1.5 dBTP to leave headroom for the lossy encodes; the check threshold is -1.0 dBTP.
If the music bed makes the mix too dynamic for linear mode, `loudnorm` falls back to dynamic mode and the report notes it.

### 3.10 Web encodes

`src/commercial/encode.ts` writes, per aspect, into `commercials/<id>/out/`:

- `<id>-<aspect>.mp4`: H.264 High, `yuv420p`, CRF 23, `preset slow`, AAC 128k stereo 48 kHz, `+faststart`.
- `<id>-<aspect>.webm`: VP9 two-pass, CRF 33, Opus 96k.
- `<id>-<aspect>-poster.webp`, from the scene the script marks as `poster` (default: the first take scene, at its mid-point).
- `<id>-<aspect>.srt` when `captions.srt` is true.

There is no loop seam crossfade (that is for silent demo loops).
Size budget: the check warns above 8 MB per 30 s of 1080p MP4.
The existing `ffmpeg` helper and `probeDuration` are reused.

## 4. Audio sources

Everything here must cost zero: the rule is never pay, and demo-kit makes no paid or metered API calls.
Every licence statement below is from memory of the providers' public terms and **must be re-verified from the provider's current page before any public release**; the manifest in 4.2 records who checked what and when.

### 4.1 Voice-over

**Local, free, open source only.**
No voice-over step calls Cloudflare Workers AI, or any other paid or metered API.
There is no neuron ledger and no daily cap for voice, because there is nothing metered to count.
Everything runs on this machine's CPU, or in GitHub Actions on this public repository (free minutes).

For the record, the account-wide split of the free 10,000 neurons a day (owner decision) leaves demo-kit out of it:

| Consumer | Daily slice (neurons) |
| --- | --- |
| PortfolioRank images | 5,000 |
| Everything else | 1,000 |
| Buffer, never used | 4,000 |
| **At most used** | **6,000 of 10,000** |

Later, all apps that do use Workers AI should reserve from one shared account-wide ledger; that is outside this plan.

**Primary: Kokoro-82M.**
- An open-weight 82 million parameter TTS model that runs on CPU, with no account, key or quota.
- Licence, checked 2026-11-10: the model card (https://huggingface.co/hexgrad/Kokoro-82M) declares **Apache-2.0**, and the `kokoro` Python package (https://github.com/hexgrad/kokoro) is Apache-2.0 too.
  This is evidence to record in the manifest, not a replacement for reading the card again before a public release (see the licence gate in 4.2).
- It is a subprocess provider (a small Python script run with `uv`, or an ONNX build), installed outside `package.json` so the repo stays pure Node; `kokoro.ts` shells out and reads a WAV back.
- The phonemizer it needs (`espeak-ng`, GPL-3.0) runs as a separate program and is not linked into demo-kit or its output; this must be re-read at the licence gate, together with the licence of each voice pack used.

**Backup: Piper.**
- A fast local neural TTS that runs on CPU as a subprocess, used only if Kokoro sounds wrong or breaks.
- The original `rhasspy/piper` (MIT) is archived; its maintained successor `OHF-Voice/piper1-gpl` is **GPL-3.0**.
  Running it as a separate program does not make demo-kit or its audio GPL, but that reading must be confirmed at the licence gate.
- **Every Piper voice has its own licence** (several are CC0 or MIT, others are CC-BY or non-commercial).
  A Piper voice is usable only after its own model card is read and recorded in `licenses.json` (kind `voice`); a voice with a non-commercial or unclear licence is refused.

**Where it runs.**
- Locally for the owner's iteration.
- In GitHub Actions for builds that should not depend on this machine: the repository is public, so the minutes are free.
  Actions installs Kokoro, synthesizes the missing lines and uploads them as workflow artifacts.
- CI's own e2e uses the stub provider (section 6.3), so ordinary pull requests never download a model.

**Cache.**
Each line is stored as `commercials/<id>/audio/vo/<sha256>.mp3`, where the hash covers provider, speaker, model version and the exact text.
Editing a line synthesizes only that line.
`audio/lines.json` maps line ids to files and measured durations.
The scratch cache is gitignored.
When a commercial is approved, its final lines are copied to `commercials/<id>/voice/` (a few tens of kB each) and committed, so any checkout or Actions run can render it without synthesizing again, and the voice cannot drift when the model changes.

**Rules, enforced in code and tests:**

1. A provider is a local subprocess.
   The `TtsProvider` interface has no network client, and a test fails if any file under `src/commercial/` imports an HTTP client for a voice call or names a Workers AI endpoint.
2. Model downloads (Kokoro weights, Piper voices) happen once, by an explicit `commercial setup-voice` step the owner runs, from the pinned source URL, with a recorded SHA-256; a build never downloads anything.
3. A missing provider or model is an error that says what to install; it never falls back to a metered service.

**Voice choice needs the owner.**
`commercial audition` produces the same two sentences in every candidate voice, named by provider and voice, into `commercials/_audition/`, and prints the paths.
The owner plays them locally and picks one.
Until then the example scripts say `speaker: 'TBD-after-audition'` and `commercial voice` refuses to run on that value.

**Licence check required.**
The Kokoro model card and package licence, each voice pack used, the phonemizer, and (for Piper) the program and the chosen voice's model card, must be read for: commercial use of generated audio, attribution, and any restriction on use in advertising.
Record the result in `licenses.json` for the voice (kind `voice`).
This is a gate for a public release, not for internal pipeline tests.

### 4.2 Music and the licence manifest

- Sources, in order of preference: CC0 tracks (public domain dedication, nothing to track beyond the source), then Pixabay Music (free for commercial use without credit under the Pixabay Content Licence).
- The safest rule is CC0 or no music.
  The Pixabay licence has conditions (for example, no standalone redistribution of the track, and some tracks may be claimed by content-ID systems) that must be re-read before relying on it.
- Music is never downloaded by the build.
  The owner or Claude picks a track by hand, saves it under `commercials/<id>/assets/music/`, and fills in its manifest entry.

`commercials/<id>/licenses.json`:

```ts
export interface LicenseManifest {
  version: 1
  assets: LicenseEntry[]
}

export interface LicenseEntry {
  /** Path under commercials/<id>/ (or 'voice:kokoro/<voice>' for the voice). */
  file: string
  kind: 'music' | 'sfx' | 'voice' | 'font' | 'image'
  title: string
  author: string
  sourceUrl: string
  license: 'CC0-1.0' | 'Pixabay-Content-License' | 'Apache-2.0' | 'OFL-1.1' | 'generated' | 'provider-terms' | 'other'
  licenseUrl: string
  attributionRequired: boolean
  /** Text to publish if attribution is required. */
  attribution?: string
  /** SHA-256 of the file, so a swapped file is noticed. */
  sha256: string
  retrievedAt: string
  /** A person who read the licence page on `verifiedAt`. 'unverified' blocks a public release. */
  verifiedBy: 'unverified' | string
  verifiedAt?: string
  publicRelease: 'blocked' | 'cleared'
}
```

`commercial check --release` fails if any asset in the script is missing from the manifest, has a mismatched hash, is `blocked`, or is `unverified`.
Without `--release` these are `warn`.
Google Fonts used through `@remotion/google-fonts` are OFL or Apache licensed and get entries of kind `font`.

**Licence gate (before any public release).**
Nothing is published, uploaded or shared outside the owner's own machine until every item below is `cleared` in `licenses.json` by a person who read the current page on a recorded date (`verifiedAt`, no older than 90 days at release time) and saved its URL and, where the page can change, a copy or archive link:

- The voice: the Kokoro model card and the chosen voice pack, or the Piper program and the chosen voice's own model card (commercial use of generated audio, attribution, advertising limits).
- Every music track, and every sound that is not generated by our code.
- Every font and logo.
- Remotion: free for individuals and companies of up to 3 people; re-check the current terms and the company's size at release time.
- The products shown: take footage of someone else's site, logo or data needs the owner's right to show it.

`commercial check --release` fails on any missing, `unverified` or stale entry, and the M7 acceptance requires a passing `--release` run.
The statements in this plan are from memory and are never the evidence; the manifest is.

### 4.3 Generated sound effects

- `sfx.ts` synthesizes a click (about 20 ms of filtered noise plus a decaying 1.8 kHz sine), a soft pop, and a whoosh (band-passed noise with a rising then falling cutoff, 400 ms) as 48 kHz mono WAVs, deterministically (seeded noise), into `commercials/<id>/audio/sfx/`.
- They are generated by our own code, so their manifest entries are `license: 'generated'`, `publicRelease: 'cleared'`.
- Clicks are timed from the take's `press` events, so they land on the visual ripple.

## 5. The `commercial check` report

`demo-kit commercial check <id>` runs after `render`, reads only the encoded files, the timeline and the lock, and writes `commercials/<id>/out/check.json`.
It prints one line per check and exits 1 if any check failed.
It sends nothing to Claude and costs no tokens.

### 5.1 Checks and thresholds

| Check id | What it measures | Tool | Pass | Warn | Fail |
| --- | --- | --- | --- | --- | --- |
| `duration.total` | Final video length against `targetSeconds` | `ffprobe` | within 0.5 s | within 1.0 s | beyond 1.0 s |
| `duration.scenes` | Each scene's rendered length against the timeline | timeline plus `ffprobe` | each within 2 frames | | beyond 2 frames |
| `duration.av` | Video stream length vs audio stream length | `ffprobe` | within 50 ms | within 150 ms | beyond 150 ms |
| `loudness.integrated` | Integrated loudness of the final mix | `ffmpeg ebur128` | -14 LUFS +/- 1.0 | +/- 1.5 | beyond 1.5 |
| `loudness.truePeak` | True peak | `ffmpeg ebur128 peak=true` | at most -1.0 dBTP | | above -1.0 |
| `loudness.range` | Loudness range | `ebur128` | at most 11 LU | at most 14 | above 14 |
| `audio.clipping` | Samples at full scale | `astats` | none | | any |
| `silence.mix` | Silent stretches in the whole mix | `silencedetect` -50 dB | none over 0.8 s | over 0.8 s once | over 1.5 s |
| `silence.voice` | Voice line spans that are silent in the voice track | `silencedetect` on the voice stem | none | | any (a failed synthesis) |
| `video.black` | Black frames | `blackdetect` d=0.1, pic_th=0.98 | none outside declared fades | | any undeclared |
| `video.freeze` | Frozen video inside take scenes | `freezedetect` n=-60dB d=1.5 | none beyond holds the take declares | one | more than one |
| `layout.safeArea` | Text boxes outside the safe area | layout data (section 5.2) | none | | any |
| `layout.cutText` | Take text lines the frame edge cuts through | layout data | none | one | more than one |
| `captions.sync` | Each cue's start and end against its voice line | cues vs timeline | start within 100 ms, end within 150 ms | | beyond |
| `captions.readability` | Characters per second, lines per cue, characters per line | cues | at most 17 cps, 2 lines, 42 chars | up to 20 cps | beyond |
| `camera.warnings` | Planner warnings per scene and aspect | camera plans | none | any | |
| `encode.files` | Each expected file exists, streams are right (H.264, AAC, VP9, Opus), `faststart` set | `ffprobe` | all | | any missing |
| `encode.size` | File size per second | file sizes | at most 8 MB per 30 s (MP4, 1080p) | up to 1.5x | beyond |
| `licenses.manifest` | Every asset in the script has a manifest entry with a matching hash | manifest | all | any `unverified` | missing or mismatched |
| `licenses.release` | Every asset `cleared` (only with `--release`) | manifest | all | | any blocked |

### 5.2 Safe areas from layout data

- The recorder already logs `layout` events: boxes of text lines in viewport CSS pixels (`{ t, type: 'layout', lines: Box[] }`).
- For each take scene, the check samples every 0.5 s of the window, takes the camera sample for that frame (`CameraPlan.samples`), maps each text line through `toOutput` from `src/camera/plan.ts`, and compares it with the frame and the safe rectangle.
- Safe rectangles, as fractions of the output frame:

| Aspect | Left | Right | Top | Bottom |
| --- | --- | --- | --- | --- |
| 16:9 | 5% | 5% | 5% | 5% |
| 1:1 | 6% | 6% | 6% | 6% |
| 9:16 | 6% | 12% | 12% | 22% |

  The 9:16 margins keep text clear of the usual vertical-video interface overlays; the exact numbers are tuned in M6 and live in one constant.
- A line that is wholly inside the frame but partly outside the safe rectangle is `layout.safeArea`.
- A line whose visible fraction is between 5% and 95% is `layout.cutText` (text the frame edge cuts through; the planner's edge snapping aims to prevent this).
- Card, outro and caption boxes come from `@remotion/layout-utils` `measureText` in the same coordinates, and are checked against the same rectangle, plus a check that captions do not overlap a take scene's own `label`.

### 5.3 JSON shape

```ts
// src/commercial/check/report.ts
export type Status = 'pass' | 'warn' | 'fail'

export interface CheckReport {
  version: 1
  commercial: string
  checkedAt: string
  /** Hash of the lock file, so a report is tied to the takes used. */
  lockSha256: string
  release: boolean
  /** 'fail' if any result failed, else 'warn' if any warned, else 'pass'. */
  status: Status
  aspects: Array<{
    aspect: Aspect
    file: string
    seconds: number
    status: Status
    results: CheckResult[]
  }>
  /** Checks that are not per aspect (licences). */
  global: CheckResult[]
  /** Timeline summary used by the stills pass and by Claude's review. */
  scenes: Array<{ id: string; kind: 'card' | 'take' | 'outro'; start: number; end: number; stills: string[] }>
  voice: { characters: number; cacheHits: number; synthesized: number }
}

export interface CheckResult {
  id: string
  status: Status
  /** The measured value and the threshold, in plain units. */
  measured: number | string | null
  threshold: string
  /** Short and specific: where, how much. Under 200 characters. */
  detail: string
  /** Where in the video, when the problem has a place. */
  at?: Array<{ scene: string; t: number }>
}
```

A passing check is reported with `detail` of at most a few words, so a clean report stays small (about 2k tokens for two aspects).

### 5.4 The still-frame spot check

- `commercial stills` writes **3 stills per scene** from the final 16:9 MP4 (and one per scene from other aspects), as JPEG at 800 px wide (480 px wide for 9:16), quality 80, into `out/stills/<aspect>/<scene>-{a,b,c}.jpg`.
- Frame times: 15%, 50% and 85% of the scene for a take scene (start, action, end); for card and outro scenes, after the animation has settled (60% and 90% of the scene) plus the first frame after the transition.
- Stills are cut with `ffmpeg -ss`, never re-rendered, so what Claude sees is what the owner will see.
- A look at the stills answers visual questions code cannot: is the text legible, is anything cut off or covered, is the brand right, does the framing show the thing the voice line is about.
- A re-check looks only at scenes the report flagged or the owner named.

### 5.5 Review flow and token budget

Flow:

1. Claude writes or edits the script; the owner approves words and the voice (after `audition`).
2. `commercial plan` (free): fix timing problems on paper.
3. `commercial build`: voice (cached), render, normalise, encode, check, stills.
4. Claude reads `check.json` and the stills, and reports defects as concrete script or storyboard edits.
5. Rebuild; only changed lines are re-synthesized and only changed scenes are worth re-viewing.
6. The owner watches and listens to the final cut.
   Claude cannot hear audio, so voice quality, music taste and pacing feel are the owner's call; the numbers cover loudness, silence and sync.

Token estimates (Claude tokens, per commercial):

| Step | First pass | Re-check |
| --- | --- | --- |
| Read `check.json` (two aspects) | 2k | 2k |
| Stills (800 px wide 16:9 is about 480 tokens each; 15 for a 5-scene reel, 5 more at 9:16 about 300 each) | 8.5k | 3k (6 stills) |
| Script, plan output and lock | 6k | 1k |
| Reasoning and the fix list | 6k | 2k |
| **Total** | **about 23k, call it 25k** | **about 8k** |

**The review loop is bounded**, so a commercial can never become an open-ended token sink:

- One first pass (about 25k tokens) and at most **two** re-check passes (about 8k each), about 41k tokens in all per commercial.
- A re-check looks only at the report's failing or warning checks and the stills of the scenes they name; it never re-reads the whole script or all stills.
- Each pass appends a `note` entry (the existing `usage.jsonl` kind) with the tokens it used, so `demo-kit usage` shows the total.
- If a third pass would be needed, or a commercial passes 50k tokens, Claude stops and asks the owner what to change instead of looping.
- Defects the numbers can catch are fixed from `check.json` alone, without looking at stills.

For comparison, sending frames at 1 per second would cost 40 to 50k tokens and at 4 per second 160 to 200k tokens, on every pass.
No video, audio or per-frame image is ever sent.

## 6. Test plan

The render path has no tests today (`npm test` covers the planner, pre-flight and usage).
This plan adds them before the commercial code relies on that path, and adds fast tests for the new pure modules.

### 6.1 Golden checks for the existing render path (M1)

- **Fixture:** a tiny synthetic take committed under `fixtures/render/`: a handful of 640x400 frames (generated by a script, not recorded), a `take.json` with cursor, press, focus and layout events.
  It is small (under 300 KB) so it can be committed; real takes stay gitignored.
- **`clipProps` golden test:** `clipProps(log, plan, DESKTOP)` equals a committed JSON file for the fixture (rounding included).
  Updating the golden is an explicit `UPDATE_GOLDEN=1` run, reviewed in the diff.
- **`posterTime` and `readTake` unit tests:** the three branches of `posterTime` (marked, last result plus 1 s, 60% in).
- **Render smoke test:** `renderTake` on the fixture with `masterOnly: true` at low concurrency; then `ffprobe` asserts size (1280x800), frame count equals `plan.samples.length`, codec H.264, and no audio stream (the demo path must stay silent).
- **Frame goldens:** extract 3 frames from the master and compare to committed PNGs with a small tolerance (mean absolute difference below a threshold, not byte equality, to survive encoder updates).
  The tolerance and an update command are documented next to the test.
- **Encode test:** `encode()` on a 2 s synthetic master asserts the three files exist, the MP4 and WebM have no audio, the duration equals the master's, and sizes are under a budget.
- **Silent-demo guard:** a test that renders a demo and fails if the output has an audio stream.
  This protects the owner's "demos stay silent" rule against a future change.

CI: these run in the existing `checks` job if they take under a minute; the render smoke test needs Remotion's headless Chrome, so it goes in the existing `e2e` job, which already renders.

### 6.2 Commercial unit tests (alongside each module)

- `timeline.ts`: scene length from voice, fixed scenes, transition overlap arithmetic, a line that does not fit, window longer or shorter than the scene.
- `duck.ts`: described in 3.7.
- `captions.ts`: splitting, cue timing sums to the line, SRT formatting (timestamps, numbering, line endings).
- `tts.ts`: cache hit makes no provider call; the hash changes with text, speaker and model version; the provider is a stub subprocess, and a missing model gives the install message and never a network call.
- The no-metered-API test from 4.1: nothing under `src/commercial/` imports an HTTP client for voice or names a Workers AI endpoint.
- `licenses.ts`: missing entry, hash mismatch, `--release` strictness.
- `load.ts`: every rule in 2.1 has a passing and a failing script.
- Check modules: each parser (`ebur128`, `silencedetect`, `blackdetect`, `freezedetect`, `astats` output) is tested against saved real ffmpeg output text, so no ffmpeg run is needed.

### 6.3 Commercial end-to-end (M5 onward)

- The 15 s `pipeline-test` is the commercial e2e: in CI it uses a **stub TTS provider** (pre-recorded tiny tones committed as fixtures) so CI never downloads a model and never calls any API.
- It asserts the whole check report: duration, loudness near -14 LUFS, true peak at most -1 dBTP, no black frames, captions in sync, and that three stills per scene exist.
- A separate manual run with the real provider is part of M3's acceptance, not CI.

## 7. Housekeeping first

Both items land before any commercial code.

### 7.1 PR #4: TypeScript 7, keep `@types/node` on 24

- PR #4 was the Dependabot "npm-major" group bump (TypeScript 7.0.2 and `@types/node` 26).
- The app runs on Node 24 (`engines.node >=24`, CI uses Node 24), so `@types/node` stays on the 24 line; the types describe the runtime, not a newer Node.
- Done: PR #4 was closed and replaced by a PR of our own that takes TypeScript 7.0.2, keeps `@types/node` at 24.19.2 and adds a Dependabot `ignore` rule for `@types/node` majors, with a comment.
  Revisit the rule when the runtime moves.
- Acceptance: `npm run typecheck`, `lint` and `test` pass; the `e2e` job passes; `package.json` shows TypeScript 7.x and `@types/node` 24.x.

### 7.2 `takes/` retention rule

Takes are about 100 MB each; `takes/` is 1.3 GB today and is gitignored, so nothing else bounds it.

The rule:

- Keep the **newest 2 takes per storyboard**.
- Keep any take named in a `commercial.lock.json` or in a `takes/KEEP` list (one folder name per line, committed to nothing, created by hand), because a commercial must be re-renderable.
- For every other take, drop `frames/` (the bulk) after 14 days, keeping `take.json`, the camera plans, the masters' `out/` files and the logs, which are small and explain what shipped.
- Delete a whole take folder only after 60 days and only if it is not kept.

`demo-kit takes prune [--apply]` implements it:

- The default is a dry run that lists what would go and how many MB it frees.
- With `--apply`, folders are **moved to the trash** with the `trash` command (never `rm`), so a mistake is recoverable for 14 days.
- It refuses to run if a `commercials/<id>/commercial.lock.json` exists but is unreadable, or a commercial folder has none (it cannot know what is kept); with no `commercials/` folder at all (the case in M0) there is nothing to keep and it runs.
- A unit test covers the selection logic on a fake folder tree.

## 8. Milestone plan

The audit estimated 4 to 6 days in total.
The estimates below sum to **5.25 days** of focused work, plus owner review time that is not counted.
Each milestone is its own pull request (docs and code never mixed), squash-merged after green CI.

| # | Milestone | Effort | Owner approval needed |
| --- | --- | --- | --- |
| M0 | Housekeeping: PR #4 (done, replaced by our own PR) and `takes prune` (section 7) | 0.25 day | No (review the PR) |
| M1 | Golden tests for the render path (6.1) | 0.5 day | No |
| M2 | Script format, loader, timeline, profiles, card and take scenes, silent render (no audio yet) of the pipeline test in 16:9 and 1:1 | 1 day | No |
| M3 | Audio: local Kokoro (and Piper) providers, cache, setup-voice and audition commands, SFX, ducking, composition audio, loudness pass | 1 day | **Yes: the voice, after hearing the audition** |
| M4 | Captions (burned in and SRT) and web encodes | 0.5 day | No |
| M5 | `commercial check`, stills, `build`, stub-TTS e2e in CI | 1 day | No |
| M6 | 9:16: phone-sized takes, per-aspect planning, safe areas | 0.5 day | **Yes: look at the 9:16 framing** |
| M7 | The n8builds reel: NetTrailers and PortfolioRank storyboards and takes (after the portfolio refresh), copy, music, licences, final cut | 0.5 day plus recording | **Yes: the copy, the music and the final cut** |

### Acceptance criteria

**M0 Housekeeping**
- TypeScript 7 and `@types/node` 24.x are on `main`; the Dependabot ignore rule is in.
- `demo-kit takes prune` dry run lists sensible candidates on the real `takes/`; `--apply` moves to trash; tests pass.
- No change to any demo output.

**M1 Render tests**
- The golden, smoke, encode and silent-demo tests exist and pass in CI.
- Deliberately changing one pixel of `Clip` (for example, the ripple radius) makes a test fail.
- Test time added to CI is under 2 minutes.

**M2 Script, timeline and silent render**
- `commercial plan pipeline-test` prints a timeline and the estimated voice length and makes no network call.
- `commercial render pipeline-test` produces a silent 16:9 and 1:1 video with a card, a take window and an outro, joined by transitions.
- The camera plan for each aspect has no planner warnings on the test page.
- The demo `render` output is byte-identical to before for the same take (a regression test).

**M3 Audio**
- `commercial audition` writes labelled samples; the owner picks a voice and records it in the script.
- `commercial setup-voice` installs Kokoro from the pinned source with a recorded checksum; `commercial audition` writes labelled local samples and prints their paths; the owner plays them, picks a voice and records it in the script.
- A real `commercial voice` run synthesizes locally, measures each line, and fills `audio/lines.json`.
- A second run synthesizes nothing (cache).
- A missing model fails with the install message and makes no network call.
- Final mix is within -14 LUFS +/- 1 and at most -1.0 dBTP; music ducks under every voice line (verified by a unit test and by listening).
- The no-metered-API test passes (no HTTP client for voice, no Workers AI endpoint).
- The Kokoro model card licence is re-read and recorded in `licenses.json`, still `unverified` for public release until M7.

**M4 Captions and encodes**
- Burned-in captions and an SRT match the voice lines; the SRT opens correctly in a standard player.
- MP4, WebM, poster and SRT are written per aspect and play in Chrome and Safari (owner checks one).

**M5 Check, stills, build**
- `commercial check` produces the JSON in 5.3; every check in 5.1 is implemented, and each has a test that makes it fail on a bad input.
- `commercial stills` writes three stills per scene.
- `commercial build pipeline-test` passes from clean using the stub provider in CI, and from the real provider locally.
- A clean report is under 2.5k tokens.

**M6 Vertical**
- A phone-sized storyboard take exists for the test page; the 9:16 cut uses it, with no planner warnings and no safe-area failures.
- `plan` fails with a clear message when a 9:16 take is missing.
- The owner approves the 9:16 framing and safe-area numbers.

**M7 The reel**
- Storyboards and takes exist for NetTrailers and PortfolioRank (desktop and mobile), recorded with pre-flight on.
- The 30 s reel passes `commercial check --release` (all licences cleared, including the voice).
- The owner approves copy before voice is generated, the music before it is committed to the manifest, and the final cut before publishing.

### Which milestones the owner must approve

- **M3: the voice choice**, after playing the `audition` samples locally.
- **M6: the 9:16 framing and safe-area numbers.**
- **M7: copy, music and the final cut.**
- M0 to M2, M4 and M5 need only the normal pull request review.

## 9. Risks and open questions

### Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Licences are unverified for Kokoro's voices, the phonemizer, Piper voices and each music track | A public video could breach terms | `licenses.json` plus `check --release`; nothing public before every entry is `cleared`; Kokoro's Apache-2.0 card is noted (checked 2026-11-10) but re-read at release |
| Local voices may sound robotic | The commercial's quality depends on it | Audition before commitment; Piper as the alternative; the owner decides by ear |
| Someone adds a metered API call later | The account is on Workers Paid, where overage is billed | The no-metered-API test (4.1) fails the build; the rule is in goals and non-goals |
| Kokoro setup is heavy (Python, model download, espeak-ng) | Setup time and drift | One explicit `setup-voice` step with a pinned source and checksum; approved lines are committed so the voice cannot drift |
| 9:16 needs separate phone-sized takes | The effort per product doubles for vertical | Make the mobile storyboard optional per commercial; start with 16:9 and 1:1 |
| The 1080p profiles are not a copy of the 1280x800 ones | The planner's zoom rules depend on display width | Explicit calibration in M2 with the safe-area check as a safety net |
| Estimated caption word timing is off | Captions look out of sync mid-line | Line start and end are exact; if it shows, add word timestamps (open question 3) |
| Remotion's licence | Free only for individuals and companies of up to 3 people (README) | Re-check if the situation changes; unchanged by this work |
| `takes/` growth | 1.3 GB now | Section 7.2 |
| `TransitionSeries` and `<Audio>` behave differently in headless render than in preview | Silent audio bugs | The e2e asserts the audio stream and loudness on the real render |
| The new `@remotion/*` packages drift from 4.0.542 | Remotion requires matching versions | Pin all to the same version; Dependabot groups them |

### Open questions

1. **Which voice?**
   Decided by the owner after the audition in M3.
2. **Kokoro or Piper?**
   Kokoro is the default; the audition decides, and Piper needs a per-voice licence check.
3. **Are estimated word timings enough for captions?**
   If not, run a local forced alignment (for example whisper.cpp, MIT, to be licence-checked) on the cached lines to get word timestamps.
4. **Do the approved voice lines live in the repo or as artifacts?**
   The plan commits them (small), so renders are reproducible; if the owner prefers artifacts only, `voice/` becomes a workflow download.
5. **Which music?**
   No track is chosen; CC0 only is the default, and "no music" is a valid answer for the reel.
6. **Where do the 9:16 phone-sized recordings come from for Wren, NetTrailers and PortfolioRank?**
   Wren is an extension and may need an extension-aware mobile layout; if a product has no real narrow layout, 9:16 is skipped for it.
7. **When is the portfolio refresh?**
   M7 waits for it, because the takes should show the refreshed products.
8. **Does the commercial need per-scene speed changes (a sped-up wait)?**
   The plan says no: windows trim, they never speed up or slow down a take.
9. **Where are finished commercials stored for publishing?**
   `out/` is gitignored; the owner decides whether the final MP4 is uploaded to n8builds.dev's assets or elsewhere.
10. **Should `usage.jsonl` record build time for commercials?**
    The plan adds a `commercial` entry kind; if the owner prefers a separate file, that is a small change.
