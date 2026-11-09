import type React from 'react'
import { type CalculateMetadataFunction, Composition, registerRoot } from 'remotion'
import { Clip, type ClipProps } from './Clip.tsx'

const EMPTY: ClipProps = {
  width: 1280,
  height: 800,
  fps: 30,
  durationInFrames: 1,
  viewport: { width: 1280, height: 800 },
  frames: [{ t: 0, file: 'frames/000000.jpg' }],
  samples: [{ cx: 640, cy: 400, s: 1 }],
  cursor: [],
  pointer: [],
  presses: [],
  cursorPx: 30,
  accent: '#4f46e5',
  background: '#000000',
}

const metadata: CalculateMetadataFunction<ClipProps> = ({ props }) => ({
  width: props.width,
  height: props.height,
  fps: props.fps,
  durationInFrames: props.durationInFrames,
})

const Root: React.FC = () => (
  <Composition id="Clip" component={Clip} width={1280} height={800} fps={30} durationInFrames={1} defaultProps={EMPTY} calculateMetadata={metadata} />
)

registerRoot(Root)
