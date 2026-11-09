// Encodes a rendered master into the web files (ported from n8builds-web's
// scripts/product-clips/encode.sh): the last half second fades into the first
// frame so the loop has no seam, then a silent H.264 MP4, a VP9 WebM and a
// WebP poster. Aim for each file under about 1.5 MB.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface EncodeOptions {
  /** Seconds into the clip for the poster frame. */
  posterAt: number
  /** Crossfade length at the loop seam, in seconds (default 0.5). */
  seam?: number
  fps: number
  /** ffmpeg threads (default 4: the machine is shared). */
  threads?: number
}

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })

export function probeDuration(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim())
}

export function encode(master: string, outDir: string, name: string, opts: EncodeOptions): Array<{ file: string; bytes: number }> {
  const work = mkdtempSync(join(outDir, '.encode-'))
  const seam = opts.seam ?? 0.5
  const threads = String(opts.threads ?? 4)
  try {
    const first = join(work, 'first.png')
    ffmpeg(['-i', master, '-frames:v', '1', first])
    const d = probeDuration(master)
    const looped = join(work, 'looped.mkv')
    ffmpeg([
      '-i',
      master,
      '-loop',
      '1',
      '-framerate',
      String(opts.fps),
      '-t',
      String(seam),
      '-i',
      first,
      '-an',
      '-filter_complex',
      `[1:v]format=yuv420p,setsar=1,fps=${opts.fps},settb=1/${opts.fps}[f];[0:v]format=yuv420p,setsar=1,fps=${opts.fps},settb=1/${opts.fps}[v];[v][f]xfade=transition=fade:duration=${seam}:offset=${(d - seam).toFixed(3)}[o]`,
      '-map',
      '[o]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-qp',
      '0',
      '-threads',
      threads,
      looped,
    ])
    const mp4 = join(outDir, `${name}.mp4`)
    ffmpeg([
      '-i',
      looped,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '26',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-threads',
      threads,
      mp4,
    ])
    const webm = join(outDir, `${name}.webm`)
    for (const pass of [1, 2]) {
      ffmpeg([
        '-i',
        looped,
        '-an',
        '-c:v',
        'libvpx-vp9',
        '-crf',
        '41',
        '-b:v',
        '0',
        '-row-mt',
        '1',
        '-deadline',
        'good',
        '-cpu-used',
        '2',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        threads,
        '-pass',
        String(pass),
        '-passlogfile',
        join(work, 'vp9'),
        '-f',
        'webm',
        pass === 1 ? '/dev/null' : webm,
      ])
    }
    const poster = join(outDir, `${name}-poster.webp`)
    ffmpeg(['-ss', opts.posterAt.toFixed(3), '-i', master, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', poster])
    return [mp4, webm, poster].map((f) => ({ file: f, bytes: statSync(f).size }))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
