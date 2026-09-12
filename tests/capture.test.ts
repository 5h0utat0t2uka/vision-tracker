import assert from 'node:assert/strict'
import test from 'node:test'
import { captureFrame } from '../src/shared/rendering/captureFrame.ts'

function fixture(width: number, height: number, pixelRatio = 1) {
  const draws: unknown[][] = []
  const png = new Blob(['png'], { type: 'image/png' })
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...args: unknown[]) => draws.push(args) }),
    toBlob: (callback: BlobCallback, type?: string) => {
      assert.equal(type, 'image/png')
      callback(png)
    },
  }
  const overlay = {
    width: Math.round(width * pixelRatio), height: Math.round(height * pixelRatio),
    getBoundingClientRect: () => ({ width, height }),
    ownerDocument: { createElement: () => canvas },
  } as unknown as HTMLCanvasElement
  const video = { readyState: 2, videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
  return { canvas, overlay, video, draws, png }
}

test('capture draws only the original video and overlay, then encodes PNG', async () => {
  const f = fixture(640, 360, 2)
  const result = captureFrame(f.video, f.overlay)
  assert.deepEqual(f.draws, [
    [f.video, 0, 0, 1280, 720, 0, 0, 1280, 720],
    [f.overlay, 0, 0, 1280, 720],
  ])
  assert.equal(await result, f.png)
})

test('portrait viewport crops the center of the camera frame', async () => {
  const f = fixture(360, 720)
  await captureFrame(f.video, f.overlay)
  assert.deepEqual(f.draws[0], [f.video, 460, 0, 360, 720, 0, 0, 360, 720])
})

test('wide viewport crops vertically using CSS size independently of DPR', async () => {
  const f = fixture(1280, 360, 1.5)
  await captureFrame(f.video, f.overlay)
  assert.deepEqual(f.draws[0], [f.video, 0, 180, 1280, 360, 0, 0, 1920, 540])
  assert.deepEqual(f.draws[1], [f.overlay, 0, 0, 1920, 540])
})

test('capture rejects unavailable video and zero-sized viewports', () => {
  const f = fixture(640, 360)
  assert.throws(() => captureFrame({ ...f.video, readyState: 1 } as HTMLVideoElement, f.overlay), /No camera frame/)
  const hidden = fixture(0, 0)
  assert.throws(() => captureFrame(hidden.video, hidden.overlay), /No camera frame/)
  assert.deepEqual(f.draws, [])
})

test('capture reports PNG encoding failure', async () => {
  const f = fixture(640, 360)
  f.canvas.toBlob = callback => callback(null)
  await assert.rejects(captureFrame(f.video, f.overlay), /Unable to encode/)
})
