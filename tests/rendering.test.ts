import assert from 'node:assert/strict'
import test from 'node:test'
import { TrackingEngine } from '../src/components/background-subtraction/TrackingEngine.ts'
import {
  ANALYSIS_LONG_EDGES,
  getAnalysisSize,
  DEFAULT_ANALYSIS_LONG_EDGE,
  OPENING_KERNEL_SIZES,
  isAnalysisLongEdge,
  type AnalysisLongEdge,
} from '../src/components/shared/tracking/analysisConfig.ts'
import type { TrackingSettings } from '../src/components/background-subtraction/types.ts'
import { OverlayRenderer } from '../src/components/shared/tracking/OverlayRenderer.ts'
import { BlobTracker } from '../src/components/shared/tracking/BlobTracker.ts'
import type { Rect, Track } from '../src/components/shared/tracking/types.ts'
import { isRegionEffect, REGION_EFFECT_OPTIONS } from '../src/components/shared/rendering/regionEffect.ts'
import { webglFixture } from './helpers/webgl.ts'

const SETTINGS: TrackingSettings = {
  motionThreshold: 20,
  backgroundTimeConstantMs: 3300,
  minBlobAreaRatio: 0.02,
  maxMissingDurationMs: 300,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
  showTrail: true,
  regionEffect: 'grayscale',
}

test('Region effectは定義済みの選択肢だけを受け付ける', () => {
  assert.deepEqual(REGION_EFFECT_OPTIONS.map(option => option.value), ['grayscale', 'invert', 'false-color', 'none'])
  for (const { value } of REGION_EFFECT_OPTIONS) assert.equal(isRegionEffect(value), true)
  for (const value of ['', 'Grayscale', 'blur', 'grayscale(1)', 'showGrayscale']) {
    assert.equal(isRegionEffect(value), false)
  }
})

test('Region effectの切り替えは追跡状態を変更せず、Noneでも矩形と軌跡を維持する', () => {
  const tracker = new BlobTracker(640, 480)
  const bbox = { x: 100, y: 100, width: 40, height: 80 }
  const observation = { bbox, center: { x: 120, y: 140 }, area: 3200 }
  tracker.update([observation], 0, SETTINGS)
  assert.equal(tracker.getTracks().length, 0)
  tracker.update([observation], 100, SETTINGS)
  const before = structuredClone(tracker.getTracks())
  const filtered = canvasFixture()
  const overlay = canvasFixture()
  const renderer = new OverlayRenderer(filtered.canvas, overlay.canvas, 640, 480)
  renderer.resize(640, 480, 1)
  const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement
  for (let frame = 0; frame < 30; frame++) {
    renderer.render(tracker.getTracks(), video, { showTrail: true, regionEffect: 'grayscale' })
  }
  assert.equal(filtered.drawCalls.length, 30)
  assert.deepEqual(tracker.getTracks(), before)
  assert.ok(before[0].trail.length > 1)
  for (const regionEffect of ['invert', 'false-color', 'none', 'grayscale'] as const) {
    const draws: number = filtered.drawCalls.length
    const boxes = overlay.boxes.length
    const strokes = overlay.strokes
    const clears = filtered.clears
    renderer.render(tracker.getTracks(), video, { showTrail: true, regionEffect })
    assert.equal(filtered.drawCalls.length, draws + (regionEffect === 'none' ? 0 : 1))
    assert.equal(filtered.clears, clears + 1)
    assert.equal(overlay.boxes.length, boxes + 1)
    assert.equal(overlay.strokes, strokes + 1)
    assert.deepEqual(tracker.getTracks(), before)
  }
  const strokes = overlay.strokes
  renderer.render(tracker.getTracks(), video, { showTrail: false, regionEffect: 'none' })
  assert.equal(overlay.strokes, strokes)
  assert.equal(overlay.boxes.length, 35)
  assert.equal(filtered.clears, overlay.clears)
  tracker.reset()
  assert.deepEqual(tracker.getTracks(), [])
})

test('背景差分は実行した区間だけ計測し、重複フレームは統計を増やさずリセットで消去する', (t) => {
  let clock = 0
  t.mock.method(performance, 'now', () => ++clock)
  const engine = new TrackingEngine(canvasFixture().canvas, canvasFixture().canvas, canvasFixture().canvas)
  const video = { videoWidth: 5, videoHeight: 5 } as HTMLVideoElement
  assert.equal(engine.process(video, 0, SETTINGS).isCalibrating, true)
  const warmup = engine.getTimingSummary()
  assert.deepEqual(warmup.capture, { average: 1, p95: 1 })
  assert.deepEqual(warmup.motion, { average: 1, p95: 1 })
  assert.deepEqual(warmup.components, { average: 0, p95: 0 })
  assert.deepEqual(warmup.tracking, { average: 0, p95: 0 })
  for (let timestamp = 100; timestamp <= 800; timestamp += 100) engine.process(video, timestamp, SETTINGS)
  const summary = engine.getTimingSummary()
  for (const key of ['capture', 'motion', 'components', 'tracking', 'render'] as const) {
    assert.deepEqual(summary[key], { average: 1, p95: 1 })
  }
  assert.ok(summary.total.average > 1)
  const calls = clock
  engine.process(video, 800, SETTINGS)
  assert.equal(clock, calls)
  assert.deepEqual(engine.getTimingSummary(), summary)
  engine.resetTimings()
  for (const timing of Object.values(engine.getTimingSummary())) {
    assert.deepEqual(timing, { average: 0, p95: 0 })
  }
  // Resetting statistics alone must not restart background calibration.
  assert.equal(engine.process(video, 900, SETTINGS).isCalibrating, false)
  engine.reset()
  assert.equal(engine.getTimingSummary().total.average, 0)
  assert.equal(engine.process(video, 1000, SETTINGS).isCalibrating, true)
})

// Record drawing operations without relying on a browser or real camera.
function canvasFixture() {
  const gpu = webglFixture()
  const drawCalls: unknown[][] = []
  const boxes: number[][] = []
  const transforms: number[][] = []
  let clears = 0
  let strokes = 0
  let reads = 0
  let region: Rect | null = null
  const context = {
    drawImage: (...args: unknown[]) => drawCalls.push(args),
    clearRect: () => { clears += 1 },
    setTransform: (...args: number[]) => transforms.push(args),
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    setLineDash() {}, moveTo() {}, lineTo() {}, stroke() { strokes += 1 }, arc() {}, fill() {},
    fillRect() {}, fillText() {},
    strokeRect: (...args: number[]) => boxes.push(args),
    measureText: () => ({ width: 40 }),
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      reads += 1
      const data = new Uint8ClampedArray(width * height * 4)
      if (region) {
        for (let y = region.y; y < region.y + region.height; y += 1) {
          for (let x = region.x; x < region.x + region.width; x += 1) {
            data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4)
          }
        }
      }
      return { width, height, data, colorSpace: 'srgb' }
    },
  }
  const canvas = { width: 0, height: 0, getContext: () => context, ownerDocument: { createElement: () => gpu.canvas } } as unknown as HTMLCanvasElement
  return {
    canvas, drawCalls, boxes, transforms, gpu,
    get clears() { return clears },
    get strokes() { return strokes },
    get reads() { return reads },
    setRegion(value: Rect | null) { region = value },
  }
}

test('解析寸法は入力の縦横比を保持して長辺320以内に収める', () => {
  assert.deepEqual(getAnalysisSize(1280, 720, 320), { width: 320, height: 180 })
  assert.deepEqual(getAnalysisSize(720, 1280, 320), { width: 180, height: 320 })
  assert.deepEqual(getAnalysisSize(640, 480, 320), { width: 320, height: 240 })
  assert.deepEqual(getAnalysisSize(1000, 1000, 320), { width: 320, height: 320 })
  assert.deepEqual(getAnalysisSize(160, 90), { width: 160, height: 90 })
  assert.throws(() => getAnalysisSize(0, 720), RangeError)
})

test('長辺480では横長480×270・縦長270×480になり、4:3や小さい入力も比率を維持する', () => {
  assert.deepEqual(getAnalysisSize(1280, 720, 480), { width: 480, height: 270 })
  assert.deepEqual(getAnalysisSize(720, 1280, 480), { width: 270, height: 480 })
  assert.deepEqual(getAnalysisSize(640, 480, 480), { width: 480, height: 360 })
  assert.deepEqual(getAnalysisSize(1000, 1000, 480), { width: 480, height: 480 })
  assert.deepEqual(getAnalysisSize(160, 90, 480), { width: 160, height: 90 })
})

for (const [sourceWidth, sourceHeight, longEdge] of [
  [1280, 720, 320], [720, 1280, 320],
  [1280, 720, 480], [720, 1280, 480],
] as const) {
  test(`${sourceWidth}x${sourceHeight}・長辺${longEdge}のcover座標は切り抜き映像と枠で一致する`, () => {
    const filtered = canvasFixture()
    const overlay = canvasFixture()
    const { width, height } = getAnalysisSize(sourceWidth, sourceHeight, longEdge)
    const renderer = new OverlayRenderer(filtered.canvas, overlay.canvas, width, height)
    renderer.resize(640, 480, 3)
    assert.equal(filtered.canvas.width, 640)
    assert.equal(filtered.canvas.height, 480)
    assert.equal(overlay.canvas.width, 1280)
    assert.equal(overlay.canvas.height, 960)
    assert.deepEqual(filtered.transforms.at(-1), [1, 0, 0, 1, 0, 0])
    assert.deepEqual(overlay.transforms.at(-1), [2, 0, 0, 2, 0, 0])
    const bbox = { x: 0, y: 0, width, height }
    const center = { x: width / 2, y: height / 2 }
    const track: Track = {
      id: 1, bbox, center, velocity: { x: 0, y: 0 },
      lastObservedCenter: center, lastObservedBox: bbox, lastObservedAtMs: 0,
      state: 'confirmed', hits: 2, trail: [],
    }
    const video = { videoWidth: sourceWidth, videoHeight: sourceHeight } as HTMLVideoElement
    renderer.render([track], video, { showTrail: false, regionEffect: 'grayscale' })
    const scale = Math.max(640 / sourceWidth, 480 / sourceHeight)
    const destination = [(640 - sourceWidth * scale) / 2, (480 - sourceHeight * scale) / 2, sourceWidth * scale, sourceHeight * scale]
    const drawn = filtered.drawCalls[0]
    assert.deepEqual(drawn.slice(1, 5), [0, 0, sourceWidth, sourceHeight])
    for (let index = 0; index < 4; index += 1) {
      assert.ok(Math.abs(Number(drawn[index + 5]) - destination[index]) < 1e-9)
      assert.ok(Math.abs(overlay.boxes[0][index] - destination[index]) < 1e-9)
    }
    renderer.render([{ ...track, state: 'lost' }], video, { showTrail: false, regionEffect: 'grayscale' })
    assert.equal(filtered.drawCalls.length, 1)
    assert.equal(overlay.boxes.length, 2)
    renderer.clear()
    assert.equal(filtered.clears, overlay.clears)
  })
}

test('解析解像度の切り替えで背景・追跡を初期化し、後続フレームや回転でも選択を維持する', () => {
  const analysis = canvasFixture()
  const filtered = canvasFixture()
  const overlay = canvasFixture()
  const engine = new TrackingEngine(analysis.canvas, filtered.canvas, overlay.canvas)
  const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
  engine.syncVideoSize(video, 320)
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += 100) {
    engine.process(video, timestampMs, SETTINGS)
  }
  analysis.setRegion({ x: 20, y: 20, width: 80, height: 60 })
  engine.process(video, 850, SETTINGS)
  assert.equal(engine.process(video, 900, SETTINGS).trackCount, 1)

  const clears = filtered.clears
  engine.syncVideoSize(video, 480)
  assert.equal(analysis.canvas.width, 480)
  assert.equal(analysis.canvas.height, 270)
  assert.ok(filtered.clears > clears)
  const result = engine.process(video, 900, SETTINGS)
  assert.equal(result.isCalibrating, true)
  assert.equal(result.trackCount, 0)
  for (let timestampMs = 1000; timestampMs <= 1700; timestampMs += 100) {
    engine.process(video, timestampMs, SETTINGS)
    assert.equal(analysis.canvas.width, 480)
  }
  const calibrated = engine.process(video, 1800, SETTINGS)
  assert.equal(calibrated.isCalibrating, false)
  engine.syncVideoSize(video, 480)
  assert.equal(engine.process(video, 1900, SETTINGS).isCalibrating, false)

  engine.syncVideoSize(video, 320)
  assert.equal(analysis.canvas.width, 320)
  assert.equal(analysis.canvas.height, 180)
  assert.equal(engine.process(video, 1900, SETTINGS).isCalibrating, true)

  engine.syncVideoSize(video, 480)
  Object.assign(video, { videoWidth: 720, videoHeight: 1280 })
  engine.syncVideoSize(video)
  assert.equal(analysis.canvas.width, 270)
  assert.equal(analysis.canvas.height, 480)
  engine.syncVideoSize(video, 320)
  assert.equal(analysis.canvas.width, 180)
  assert.equal(analysis.canvas.height, 320)
})

test('映像取得前に選んだ解析解像度は取得・リセット後も維持する', () => {
  const analysis = canvasFixture()
  const engine = new TrackingEngine(analysis.canvas, canvasFixture().canvas, canvasFixture().canvas)
  const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement
  engine.syncVideoSize(video, 480)
  Object.assign(video, { videoWidth: 1280, videoHeight: 720 })
  engine.process(video, 0, SETTINGS)
  assert.equal(analysis.canvas.width, 480)
  engine.reset()
  engine.process(video, 100, SETTINGS)
  assert.equal(analysis.canvas.width, 480)
})

test('入力サイズ変更で解析バッファと背景を再初期化する', () => {
  const analysis = canvasFixture()
  const filtered = canvasFixture()
  const overlay = canvasFixture()
  const engine = new TrackingEngine(analysis.canvas, filtered.canvas, overlay.canvas)
  const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
  engine.syncVideoSize(video, 320)
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += 100) {
    engine.process(video, timestampMs, SETTINGS)
  }
  assert.equal(analysis.canvas.width, 320)
  assert.equal(analysis.canvas.height, 180)
  Object.assign(video, { videoWidth: 720, videoHeight: 1280 })
  engine.syncVideoSize(video)
  assert.equal(analysis.canvas.width, 180)
  assert.equal(analysis.canvas.height, 320)
  assert.equal(engine.process(video, 900, SETTINGS).isCalibrating, true)
  assert.equal(filtered.clears, overlay.clears)
})

test('重複フレームを再解析せず、中断・巻き戻り・リセットで追跡を初期化する', () => {
  const analysis = canvasFixture()
  const filtered = canvasFixture()
  const overlay = canvasFixture()
  const engine = new TrackingEngine(analysis.canvas, filtered.canvas, overlay.canvas)
  const video = { videoWidth: 5, videoHeight: 5 } as HTMLVideoElement
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += 100) {
    engine.process(video, timestampMs, SETTINGS)
  }
  analysis.setRegion({ x: 1, y: 1, width: 3, height: 3 })
  engine.process(video, 850, SETTINGS)
  const confirmed = engine.process(video, 900, SETTINGS)
  assert.equal(confirmed.trackCount, 1)
  const reads = analysis.reads
  assert.deepEqual(engine.process(video, 900, SETTINGS), confirmed)
  assert.equal(analysis.reads, reads)
  const resumed = engine.process(video, 2000, SETTINGS)
  assert.equal(resumed.isCalibrating, true)
  assert.equal(resumed.trackCount, 0)
  assert.equal(engine.process(video, 0, SETTINGS).isCalibrating, true)
  engine.reset()
  assert.equal(engine.process(video, 0, SETTINGS).isCalibrating, true)
  assert.throws(() => engine.process(video, NaN, SETTINGS), RangeError)
})

test('解析解像度の初期値と全選択肢は共通定数に従う', () => {
  assert.equal(DEFAULT_ANALYSIS_LONG_EDGE, 320)
  assert.deepEqual(OPENING_KERNEL_SIZES, { 320: 3, 480: 5 })
  assert.ok(isAnalysisLongEdge(DEFAULT_ANALYSIS_LONG_EDGE))
  const analysis = canvasFixture()
  const engine = new TrackingEngine(analysis.canvas, canvasFixture().canvas, canvasFixture().canvas)
  const sourceLongEdge = Math.max(...ANALYSIS_LONG_EDGES) * 2
  const video = { videoWidth: sourceLongEdge, videoHeight: sourceLongEdge } as HTMLVideoElement
  engine.syncVideoSize(video)
  assert.equal(analysis.canvas.width, DEFAULT_ANALYSIS_LONG_EDGE)
  assert.equal(getAnalysisSize(sourceLongEdge, sourceLongEdge).width, DEFAULT_ANALYSIS_LONG_EDGE)
  for (const longEdge of ANALYSIS_LONG_EDGES) {
    assert.ok(isAnalysisLongEdge(longEdge))
    assert.ok(Number.isInteger(longEdge) && longEdge > 0)
    engine.syncVideoSize(video, longEdge)
    assert.equal(analysis.canvas.width, longEdge)
    assert.equal(analysis.canvas.height, longEdge)
  }
})

for (const [sourceWidth, sourceHeight] of [[1280, 720], [720, 1280], [160, 90]]) {
  test(`${sourceWidth}×${sourceHeight}入力で320→480→320の切り替えにopeningが連動する`, () => {
    const analysis = canvasFixture()
    const engine = new TrackingEngine(analysis.canvas, canvasFixture().canvas, canvasFixture().canvas)
    const video = { videoWidth: sourceWidth, videoHeight: sourceHeight } as HTMLVideoElement
    const settings = { ...SETTINGS, minBlobAreaRatio: 0 }
    for (const longEdge of [320, 480, 320] as const) {
      analysis.setRegion(null)
      engine.syncVideoSize(video, longEdge)
      assert.equal(engine.process(video, 0, settings).isCalibrating, true)
      assert.equal(engine.process(video, 700, settings).isCalibrating, false)
      analysis.setRegion({ x: 10, y: 10, width: 3, height: 3 })
      assert.equal(engine.process(video, 750, settings).detectionCount, longEdge === 320 ? 1 : 0)
      analysis.setRegion({ x: 10, y: 10, width: 5, height: 5 })
      assert.equal(engine.process(video, 800, settings).detectionCount, 1)
    }
  })
}

test('無効な解像度は取得前でも拒否し、設定を上書きしない', () => {
  const analysis = canvasFixture()
  const engine = new TrackingEngine(analysis.canvas, canvasFixture().canvas, canvasFixture().canvas)
  const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(isAnalysisLongEdge(value), false)
    assert.throws(() => engine.syncVideoSize(video, value as AnalysisLongEdge), RangeError)
    assert.throws(() => getAnalysisSize(1280, 720, value as AnalysisLongEdge), RangeError)
  }
  Object.assign(video, { videoWidth: 1920, videoHeight: 1080 })
  engine.syncVideoSize(video)
  assert.equal(analysis.canvas.width, DEFAULT_ANALYSIS_LONG_EDGE)
})
