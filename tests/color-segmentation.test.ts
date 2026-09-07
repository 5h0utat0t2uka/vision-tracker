import assert from 'node:assert/strict'
import test from 'node:test'
import { ColorDetector, getColorMode, hexToHsv, isHexColor, rgbToHsv } from '../src/components/color-segmentation/ColorDetector.ts'
import { ColorTrackingEngine } from '../src/components/color-segmentation/ColorTrackingEngine.ts'
import { DEFAULT_COLOR_SETTINGS, type ColorTrackingSettings } from '../src/components/color-segmentation/config.ts'
import { ConnectedComponents } from '../src/components/shared/tracking/ConnectedComponents.ts'
import { BlobTracker } from '../src/components/shared/tracking/BlobTracker.ts'

function frame(width: number, height: number, paint: (x: number, y: number) => readonly number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = paint(x, y)
    data.set([color[0], color[1], color[2], color[3] ?? 255], (y * width + x) * 4)
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData
}
const redPatch = (x: number, y: number) => x >= 3 && x <= 7 && y >= 3 && y <= 7 ? [255, 0, 0] : [0, 0, 255]

function matches(rgb: readonly number[], settings = DEFAULT_COLOR_SETTINGS): boolean {
  return new ColorDetector(5, 5).process(frame(5, 5, () => rgb), settings).mask[12] === 1
}

test('RGB/HEXからHSVへ変換し、純色・無彩色・色入力の形式を扱う', () => {
  assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 })
  assert.deepEqual(hexToHsv('#00FF00'), { h: 120, s: 1, v: 1 })
  assert.deepEqual(rgbToHsv(0, 0, 255), { h: 240, s: 1, v: 1 })
  assert.deepEqual(hexToHsv('#ffffff'), { h: 0, s: 0, v: 1 })
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 })
  assert.equal(getColorMode(hexToHsv('#808080')), 'neutral')
  assert.equal(getColorMode(hexToHsv('#001000')), 'dark')
  assert.equal(getColorMode(hexToHsv('#ff0000')), 'chromatic')
  for (const value of ['red', '#fff', '#ff000000', 'color(display-p3 1 0 0)', '#gg0000']) {
    assert.equal(isHexColor(value), false)
    assert.throws(() => hexToHsv(value), RangeError)
  }
  const scratch = { h: 0, s: 0, v: 0 }
  assert.equal(rgbToHsv(255, 0, 255, scratch), scratch)
  assert.equal(scratch.h, 300)
})

test('赤は0°と360°をまたいで検出し、許容幅外の色・白・黒を除く', () => {
  const settings = { ...DEFAULT_COLOR_SETTINGS, hueTolerance: 3 }
  assert.ok(matches([255, 0, 8], settings))
  assert.ok(matches([255, 8, 0], settings))
  for (const rgb of [[255, 85, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0]]) assert.equal(matches(rgb, settings), false)
  assert.ok(matches([255, 0, 0], { ...settings, hueTolerance: 0 }))
  assert.equal(matches([255, 0, 0, 0], settings), false)
})

test('明るさ・彩度の許容幅は選択色を中心に独立して作用する', () => {
  assert.ok(matches([200, 0, 0]))
  assert.equal(matches([100, 0, 0]), false)
  assert.ok(matches([100, 0, 0], { ...DEFAULT_COLOR_SETTINGS, valueTolerance: 0.7 }))
  assert.equal(matches([255, 180, 180]), false)
  assert.ok(matches([255, 180, 180], { ...DEFAULT_COLOR_SETTINGS, saturationTolerance: 0.8 }))
  assert.equal(matches([255, 255, 255], { ...DEFAULT_COLOR_SETTINGS, saturationTolerance: 1 }), false)
})

test('白・灰色はS/Vで判定し、黒はVだけで判定する', () => {
  const white = { ...DEFAULT_COLOR_SETTINGS, targetColor: '#ffffff', saturationTolerance: 0.1, valueTolerance: 0.1, hueTolerance: 0 }
  assert.ok(matches([245, 250, 255], white))
  assert.equal(matches([0, 255, 0], white), false)
  assert.equal(matches([128, 128, 128], white), false)
  const gray = { ...white, targetColor: '#808080' }
  assert.ok(matches([128, 132, 128], gray))
  assert.equal(matches([0, 128, 0], gray), false)
  const black = { ...white, targetColor: '#000000', valueTolerance: 0.1, saturationTolerance: 0 }
  assert.ok(matches([0, 0, 0], black))
  assert.ok(matches([0, 20, 0], black))
  assert.equal(matches([100, 100, 100], black), false)
})

for (const kernel of [3, 5]) {
  test(`${kernel}×${kernel} openingで孤立画素を除き、色マスク・バッファを再利用する`, () => {
    const detector = new ColorDetector(11, 11, kernel)
    const image = frame(11, 11, (x, y) => x === 1 && y === 1 ? [255, 0, 0] : redPatch(x, y))
    const result = detector.process(image, DEFAULT_COLOR_SETTINGS)
    assert.equal(result.mask[12], 0)
    assert.equal(result.mask.reduce((sum, value) => sum + value, 0), 25)
    assert.equal(result.matchedRatio, 25 / 121)
    const changed = detector.process(image, { ...DEFAULT_COLOR_SETTINGS, targetColor: '#00ff00' })
    assert.equal(changed.mask, result.mask)
    assert.equal(changed.matchedRatio, 0)
  })
}

for (const fps of [15, 20, 30]) {
  test(`${fps}fpsで30秒間静止しても同じ色領域のIDを維持する`, () => {
    const detector = new ColorDetector(11, 11)
    const components = new ConnectedComponents(11, 11)
    const tracker = new BlobTracker(11, 11)
    const image = frame(11, 11, redPatch)
    for (let index = 0; index <= fps * 30; index++) {
      const { mask } = detector.process(image, DEFAULT_COLOR_SETTINGS)
      const tracks = tracker.update(components.extract(mask, 3), index * 1000 / fps, DEFAULT_COLOR_SETTINGS)
      if (index === 0) assert.equal(tracks.length, 0)
      else {
        assert.equal(tracks.length, 1)
        assert.equal(tracks[0].state, 'confirmed')
        assert.equal(tracks[0].id, 1)
        assert.deepEqual(tracks[0].velocity, { x: 0, y: 0 })
      }
    }
    assert.equal(tracker.update([], 30050, DEFAULT_COLOR_SETTINGS)[0].state, 'lost')
    assert.equal(tracker.update([], 30301, DEFAULT_COLOR_SETTINGS).length, 0)
  })
}

test('色条件の無効値・不一致サイズを拒否し、画面全体が対象色でも検出する', () => {
  for (const key of ['hueTolerance', 'saturationTolerance', 'valueTolerance'] as const) {
    for (const value of [NaN, Infinity, -1, 181]) {
      assert.throws(() => matches([255, 0, 0], { ...DEFAULT_COLOR_SETTINGS, [key]: value }), RangeError)
    }
  }
  const detector = new ColorDetector(5, 5)
  assert.throws(() => detector.process(frame(3, 3, () => [255, 0, 0]), DEFAULT_COLOR_SETTINGS), RangeError)
  assert.ok(detector.process(frame(5, 5, () => [255, 0, 0]), DEFAULT_COLOR_SETTINGS).matchedRatio > 0)
})

function engineFixture() {
  let paint = redPatch
  let reads = 0
  const draws: unknown[][] = []
  const makeCanvas = () => {
    const context = {
      drawImage: (...args: unknown[]) => { draws.push(args) },
      getImageData: (_x: number, _y: number, width: number, height: number) => { reads++; return frame(width, height, paint) },
      clearRect() {}, setTransform() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      setLineDash() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, fillRect() {}, fillText() {}, strokeRect() {},
      measureText: () => ({ width: 40 }),
    }
    return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement
  }
  const canvas = makeCanvas()
  const engine = new ColorTrackingEngine(canvas, makeCanvas(), makeCanvas())
  engine.resizeOverlay(640, 360, 2)
  const video = { videoWidth: 11, videoHeight: 11 } as HTMLVideoElement
  return { engine, canvas, video, draws, get reads() { return reads }, setPaint(value: typeof paint) { paint = value } }
}

test('背景初期化なしで検出し、色変更で追跡をリセット、描画設定変更では継続する', () => {
  const f = engineFixture()
  const settings: ColorTrackingSettings = { ...DEFAULT_COLOR_SETTINGS, minBlobAreaRatio: 0.01 }
  assert.equal(f.engine.process(f.video, 0, settings).detectionCount, 1)
  assert.equal(f.engine.process(f.video, 50, settings).trackCount, 1)
  const reads = f.reads
  const summary = f.engine.getTimingSummary()
  assert.equal(f.engine.process(f.video, 50, settings).trackCount, 1)
  assert.equal(f.reads, reads)
  assert.deepEqual(f.engine.getTimingSummary(), summary)
  let timestamp = 100
  for (const regionEffect of ['invert', 'none', 'grayscale'] as const) {
    const draws = f.draws.length
    const reads = f.reads
    const result = f.engine.process(f.video, timestamp, { ...settings, regionEffect })
    assert.equal(result.trackCount, 1)
    assert.equal(result.detectionCount, 1)
    assert.equal(f.reads, reads + 1)
    // Capture the original video every time; only enabled effects draw a region too.
    assert.equal(f.draws.length, draws + (regionEffect === 'none' ? 1 : 2))
    timestamp += 50
  }
  assert.equal(f.engine.process(f.video, timestamp, { ...settings, targetColor: '#00ff00' }).trackCount, 0)
  assert.equal(f.engine.process(f.video, timestamp, settings).trackCount, 0)
  assert.equal(f.engine.process(f.video, timestamp + 50, settings).trackCount, 1)
  assert.equal(f.engine.process(f.video, timestamp + 100, { ...settings, minBlobAreaRatio: 0.5 }).detectionCount, 0)
  assert.ok(f.draws.every(args => args[0] === f.video))
  f.engine.reset()
  assert.equal(f.engine.getTimingSummary().total.average, 0)
  assert.equal(f.engine.process(f.video, timestamp + 150, settings).trackCount, 0)
})

test('320/480の切り替え・回転・時間の巻き戻り・中断で状態を初期化する', () => {
  const f = engineFixture()
  f.engine.syncVideoSize(f.video, 480)
  f.engine.process(f.video, 0, DEFAULT_COLOR_SETTINGS)
  assert.equal(f.engine.process(f.video, 50, DEFAULT_COLOR_SETTINGS).trackCount, 1)
  f.engine.syncVideoSize(f.video, 320)
  assert.equal(f.engine.process(f.video, 50, DEFAULT_COLOR_SETTINGS).trackCount, 0)
  f.engine.process(f.video, 100, DEFAULT_COLOR_SETTINGS)
  assert.equal(f.engine.process(f.video, 0, DEFAULT_COLOR_SETTINGS).trackCount, 0)
  assert.equal(f.engine.process(f.video, 2000, DEFAULT_COLOR_SETTINGS).trackCount, 0)
  Object.assign(f.video, { videoWidth: 1280, videoHeight: 720 })
  f.engine.syncVideoSize(f.video, 480)
  assert.deepEqual([f.canvas.width, f.canvas.height], [480, 270])
  Object.assign(f.video, { videoWidth: 720, videoHeight: 1280 })
  f.engine.syncVideoSize(f.video)
  assert.deepEqual([f.canvas.width, f.canvas.height], [270, 480])
  assert.throws(() => f.engine.process(f.video, NaN, DEFAULT_COLOR_SETTINGS), RangeError)
  assert.throws(() => f.engine.process(f.video, 0, { ...DEFAULT_COLOR_SETTINGS, minBlobAreaRatio: NaN }), RangeError)
})

test('全処理区間の計測を記録し、統計だけのリセットではTrackを消さない', t => {
  let clock = 0
  t.mock.method(performance, 'now', () => ++clock)
  const f = engineFixture()
  f.engine.process(f.video, 0, DEFAULT_COLOR_SETTINGS)
  f.engine.process(f.video, 50, DEFAULT_COLOR_SETTINGS)
  const summary = f.engine.getTimingSummary()
  for (const key of ['capture', 'segmentation', 'components', 'tracking', 'render'] as const) assert.deepEqual(summary[key], { average: 1, p95: 1 })
  assert.deepEqual(summary.total, { average: 5, p95: 5 })
  f.engine.resetTimings()
  assert.equal(f.engine.getTimingSummary().capture.average, 0)
  assert.equal(f.engine.process(f.video, 100, DEFAULT_COLOR_SETTINGS).trackCount, 1)
})
