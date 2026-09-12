import assert from 'node:assert/strict'
import test from 'node:test'
import { FALSE_COLOR_BRIGHTNESS_WEIGHTS, FALSE_COLOR_STOPS, FALSE_COLOR_PALETTE, FALSE_COLOR_FILTER_TABLES, FALSE_COLOR_FILTER_MATRIX } from '../src/shared/rendering/falseColor.ts'
import { FalseColorRenderer } from '../src/shared/rendering/FalseColorRenderer.ts'
import type { Track } from '../src/shared/tracking/types.ts'
import { webglFixture } from './helpers/webgl.ts'

test('False colorのRGBAテクスチャは配色定数と不均等な区間の補間を維持する', () => {
  assert.equal(FALSE_COLOR_PALETTE.length, 256 * 4)
  assert.deepEqual(FALSE_COLOR_BRIGHTNESS_WEIGHTS, [0.2126, 0.7152, 0.0722])
  assert.equal(FALSE_COLOR_STOPS[0].brightness, 0)
  assert.equal(FALSE_COLOR_STOPS.at(-1)?.brightness, 255)
  for (const [index, stop] of FALSE_COLOR_STOPS.entries()) {
    if (index > 0) assert.ok(stop.brightness > FALSE_COLOR_STOPS[index - 1].brightness)
    assert.deepEqual([...FALSE_COLOR_PALETTE.slice(stop.brightness * 4, stop.brightness * 4 + 4)], [...stop.color, 255])
  }
  for (const [brightness, rgb] of [[40, [0, 100, 218]], [115, [0, 200, 128]], [175, [128, 228, 0]], [222, [255, 153, 0]]] as const) {
    assert.deepEqual([...FALSE_COLOR_PALETTE.slice(brightness * 4, brightness * 4 + 4)], [...rgb, 255])
  }
})

test('SVGの配色テーブルはWebGLの全256色と一致し、明るさ変換はalphaを保持する', () => {
  for (const [channel, table] of FALSE_COLOR_FILTER_TABLES.entries()) {
    const values = table.split(' ').map(Number)
    assert.equal(values.length, 256)
    for (let brightness = 0; brightness < 256; brightness++) {
      assert.equal(Math.round(values[brightness] * 255), FALSE_COLOR_PALETTE[brightness * 4 + channel])
    }
  }
  const matrix = FALSE_COLOR_FILTER_MATRIX.split(' ').map(Number)
  assert.equal(matrix.length, 20)
  for (let row = 0; row < 3; row++) {
    assert.deepEqual(matrix.slice(row * 5, row * 5 + 5), [0.2126, 0.7152, 0.0722, 0, 0])
  }
  assert.deepEqual(matrix.slice(15), [0, 0, 0, 1, 0])
})

const viewport = { analysisWidth: 320, analysisHeight: 180, cssWidth: 640, cssHeight: 360, renderWidth: 640, renderHeight: 360, offsetX: 0, offsetY: 0 }
const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
function track(x = 0, state: Track['state'] = 'confirmed'): Track {
  const bbox = { x, y: 0, width: 160, height: 90 }, center = { x: x + 80, y: 45 }
  return { id: 1, bbox, center, state, velocity: { x: 0, y: 0 }, lastObservedCenter: center, lastObservedBox: bbox, lastObservedAtMs: 0, hits: 2, trail: [] }
}

test('WebGLは全矩形を1回の動画転送で描き、移動・消失時に毎回クリアする', () => {
  const f = webglFixture(), renderer = new FalseColorRenderer(f.canvas)
  const named = (name: string) => f.calls.filter(call => call.name === name)
  renderer.render(video, [track(), track(160), track(0, 'lost')], viewport, 640, 360)
  assert.deepEqual(named('drawArrays').at(-1)?.args, [f.gl.TRIANGLES, 0, 12])
  assert.equal(named('texImage2D').filter(call => call.args.at(-1) === video).length, 1)
  const first = named('bufferSubData').at(-1)?.args[2] as Float32Array
  assert.deepEqual([...first.slice(0, 12)], [-1, 1, 0, 0, -1, 0, 0, 0.5, 0, 1, 0.5, 0])
  renderer.render(video, [track(160)], viewport, 640, 360)
  assert.equal(named('bufferData').length, 1)
  assert.deepEqual(named('drawArrays').at(-1)?.args, [f.gl.TRIANGLES, 0, 6])
  assert.equal((named('bufferSubData').at(-1)?.args[2] as Float32Array)[0], 0)
  renderer.render(video, [], viewport, 640, 360)
  assert.equal(named('clear').length, 3)
  assert.equal(named('drawArrays').length, 2)
  assert.equal(named('texImage2D').filter(call => call.args.at(-1) === video).length, 2)
  renderer.dispose()
  renderer.dispose()
  assert.equal(named('deleteTexture').length, 2)
  assert.equal(named('deleteProgram').length, 1)
  assert.equal(named('loseContext').length, 1)
})

test('WebGLはcover座標・画像端の切り詰め・リサイズを反映する', () => {
  const f = webglFixture(), renderer = new FalseColorRenderer(f.canvas)
  renderer.render(video, [track(-80)], { ...viewport, renderWidth: 1280, offsetX: -320 }, 800, 450)
  assert.equal(f.canvas.width, 800)
  assert.equal(f.canvas.height, 450)
  const data = f.calls.find(call => call.name === 'bufferSubData')?.args[2] as Float32Array
  assert.deepEqual([...data.slice(0, 4)], [-2, 1, 0, 0])
  assert.deepEqual([...data.slice(8, 12)], [-1, 1, 0.25, 0])
  renderer.dispose()
})

test('WebGLの初期化失敗・コンテキスト消失は明示的なエラーとなる', () => {
  assert.throws(() => new FalseColorRenderer(webglFixture({ unavailable: true }).canvas), /requires WebGL/)
  for (const options of [{ shaderFailure: true }, { linkFailure: true }]) {
    const f = webglFixture(options)
    assert.throws(() => new FalseColorRenderer(f.canvas), /failed/)
    assert.ok(f.calls.some(call => call.name === 'loseContext'))
  }
  const f = webglFixture(), renderer = new FalseColorRenderer(f.canvas)
  f.loseContext()
  assert.throws(() => renderer.render(video, [track()], viewport, 640, 360), /context was lost/)
  renderer.dispose()
})
