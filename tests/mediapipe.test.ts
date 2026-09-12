import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { convertMediaPipeDetections } from '../src/routes/mediapipe-tasks-vision/components/convertDetections.ts'
import {
  DEFAULT_DETECTION_CATEGORIES,
  DEFAULT_INFERENCE_CONFIGURATION,
  DEFAULT_INFERENCE_LONG_EDGE,
  INFERENCE_CONFIGURATIONS,
  isInferenceConfiguration,
  DETECTION_CATEGORIES,
  resolveMediaPipeAssetUrls,
  getInferenceSize,
  INFERENCE_LONG_EDGES,
  isInferenceLongEdge,
  type InferenceLongEdge,
  TRACK_MISSING_TOLERANCE_MS,
} from '../src/routes/mediapipe-tasks-vision/components/config.ts'
import { BlobTracker } from '../src/shared/tracking/BlobTracker.ts'
import type { Detection, TrackerSettings } from '../src/shared/tracking/types.ts'
import { ProcessingTimings, TIMING_SAMPLE_LIMIT } from '../src/shared/ProcessingTimings.ts'
import { TIMING_LABELS } from '../src/routes/mediapipe-tasks-vision/components/timingConfig.ts'

const TRACKER_SETTINGS: TrackerSettings = {
  maxMissingDurationMs: 500,
  maxMatchDistanceRatio: 0.2,
  trailDurationMs: 1700,
}

test('MediaPipe bboxをカテゴリ・信頼度・中心・面積を持つDetectionへ変換する', () => {
  const detections = convertMediaPipeDetections([
    {
      boundingBox: { originX: 100, originY: 50, width: 80, height: 200 },
      categories: [
        { categoryName: 'car', score: 0.6 },
        { categoryName: 'person', score: 0.8 },
      ],
    },
  ], new Set(['person']), 640, 480)

  assert.deepEqual(detections, [{
    categoryName: 'person',
    score: 0.8,
    bbox: { x: 100, y: 50, width: 80, height: 200 },
    center: { x: 140, y: 150 },
    area: 16000,
  }])
})

test('MediaPipe変換は未選択カテゴリ・不正bboxを除外し、画像外bboxを切り詰める', () => {
  const detections = convertMediaPipeDetections([
    {
      boundingBox: { originX: 10, originY: 10, width: 20, height: 20 },
      categories: [{ categoryName: 'dog', score: 0.9 }],
    },
    {
      boundingBox: { originX: Number.NaN, originY: 0, width: 10, height: 10 },
      categories: [{ categoryName: 'person', score: 0.9 }],
    },
    {
      boundingBox: { originX: -10, originY: 80, width: 40, height: 40 },
      categories: [{ categoryName: 'car', score: 0.7 }],
    },
  ], new Set(['person', 'car']), 100, 100)

  assert.deepEqual(detections, [{
    categoryName: 'car',
    score: 0.7,
    bbox: { x: 0, y: 80, width: 30, height: 20 },
    center: { x: 15, y: 90 },
    area: 600,
  }])
})

test('初期カテゴリは人物で、選択肢とMediaPipe asset URLは固定設定に従う', () => {
  assert.deepEqual(DEFAULT_DETECTION_CATEGORIES, ['person'])
  assert.deepEqual(DETECTION_CATEGORIES.map((category) => category.value), ['person', 'car', 'bicycle'])
  assert.deepEqual(resolveMediaPipeAssetUrls('/demo/', 'https://example.com'), {
    modelUrl: 'https://example.com/demo/mediapipe/models/efficientdet-lite0-int8-v1.tflite',
    wasmRoot: 'https://example.com/demo/mediapipe/wasm',
  })
})

test('Trackerは近接していても異なる検出カテゴリを同じIDへ関連付けない', () => {
  const tracker = new BlobTracker(640, 480)
  tracker.update([detection('person', 100)], 0, TRACKER_SETTINGS)
  assert.equal(tracker.update([detection('person', 105)], 100, TRACKER_SETTINGS)[0].id, 1)

  const tracks = tracker.update([detection('car', 106)], 200, TRACKER_SETTINGS)
  assert.equal(tracks.find((track) => track.categoryName === 'person')?.state, 'lost')
  assert.equal(tracker.update([detection('car', 108)], 300, TRACKER_SETTINGS).find((track) => track.categoryName === 'car')?.id, 2)
})

test('配置したEfficientDet-Lite0モデルは記録済みSHA-256と一致する', async () => {
  const model = await readFile(new URL('../public/mediapipe/models/efficientdet-lite0-int8-v1.tflite', import.meta.url))
  assert.equal(
    createHash('sha256').update(model).digest('hex'),
    '0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb',
  )
})

test('GPU用float16 v1モデルのSHA-256とTFLite識別子を検証する', async () => {
  const model = await readFile(new URL('../public/mediapipe/models/efficientdet-lite0-float16-v1.tflite', import.meta.url))
  assert.equal(model.subarray(4, 8).toString(), 'TFL3')
  assert.equal(createHash('sha256').update(model).digest('hex'), '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993')
})

test('初期値と4種類のモデル構成を検証する', () => {
  assert.equal(DEFAULT_INFERENCE_CONFIGURATION, 'lite0-cpu-int8')
  assert.equal(DEFAULT_INFERENCE_LONG_EDGE, 320)
  assert.equal(INFERENCE_CONFIGURATIONS['lite0-cpu-int8'].recommendedLongEdge, 320)
  assert.equal(INFERENCE_CONFIGURATIONS['lite0-gpu-float16'].recommendedLongEdge, 320)
  assert.equal(INFERENCE_CONFIGURATIONS['lite2-cpu-int8'].recommendedLongEdge, 480)
  assert.equal(INFERENCE_CONFIGURATIONS['lite2-gpu-float16'].recommendedLongEdge, 480)
  assert.equal(INFERENCE_CONFIGURATIONS['lite0-cpu-int8'].delegate, 'CPU')
  assert.equal(INFERENCE_CONFIGURATIONS['lite0-gpu-float16'].delegate, 'GPU')
  assert.equal(INFERENCE_CONFIGURATIONS['lite2-cpu-int8'].delegate, 'CPU')
  assert.equal(INFERENCE_CONFIGURATIONS['lite2-gpu-float16'].delegate, 'GPU')
  assert.ok(isInferenceConfiguration('lite0-cpu-int8'))
  assert.ok(isInferenceConfiguration('lite0-gpu-float16'))
  assert.ok(isInferenceConfiguration('lite2-cpu-int8'))
  assert.ok(isInferenceConfiguration('lite2-gpu-float16'))
  assert.equal(isInferenceConfiguration('toString'), false)
  assert.equal(isInferenceConfiguration('gpu-int8'), false)
  assert.deepEqual(resolveMediaPipeAssetUrls('/demo/', 'https://example.com', 'lite0-gpu-float16'), {
    modelUrl: 'https://example.com/demo/mediapipe/models/efficientdet-lite0-float16-v1.tflite',
    wasmRoot: 'https://example.com/demo/mediapipe/wasm',
  })
})

function detection(categoryName: string, x: number): Detection {
  return {
    categoryName,
    score: 0.8,
    bbox: { x, y: 100, width: 40, height: 80 },
    center: { x: x + 20, y: 140 },
    area: 3200,
  }
}

test('非同期検出は900ms間隔でも確定し、初回の未検出から猶予時間を数える', () => {
  const tracker = new BlobTracker(640, 480)
  const settings: TrackerSettings = {
    ...TRACKER_SETTINGS,
    missingTimeBasis: 'first-miss',
    maxMissingDurationMs: TRACK_MISSING_TOLERANCE_MS,
  }
  tracker.update([detection('person', 100)], 0, settings)
  for (const time of [900, 1800, 2700]) {
    const tracks = tracker.update([detection('person', 100)], time, settings)
    assert.equal(tracks[0].id, 1)
    assert.equal(tracks[0].state, 'confirmed')
  }
  assert.equal(tracker.update([], 3600, settings)[0].state, 'lost')
  assert.equal(tracker.update([], 4400, settings)[0].id, 1)
  // An expired ID cannot be revived, even by a nearby detection.
  assert.equal(tracker.update([detection('person', 100)], 4401, settings).length, 0)
  assert.equal(tracker.update([detection('person', 100)], 5301, settings)[0].id, 2)
  assert.equal(tracker.update([], 6201, settings)[0].state, 'lost')
  assert.equal(tracker.update([detection('person', 100)], 6501, settings)[0].id, 2)
  // Recovery clears the previous miss timer.
  assert.equal(tracker.update([detection('person', 100)], 8001, settings)[0].id, 2)
  tracker.reset()
  assert.equal(tracker.update([detection('person', 100)], 9001, settings).length, 0)
})

test('推論画像は拡大せず既定モデルの推奨長辺320に収め、丸め誤差を含め元映像座標へ戻す', () => {
  for (const [width, height] of [[1280, 720], [720, 1280], [1001, 751], [160, 90]]) {
    const size = getInferenceSize(width, height)
    assert.ok(size.width <= DEFAULT_INFERENCE_LONG_EDGE && size.height <= DEFAULT_INFERENCE_LONG_EDGE)
    assert.ok(size.width <= width && size.height <= height)
    const [result] = convertMediaPipeDetections([{
      boundingBox: { originX: size.width / 4, originY: size.height / 4, width: size.width / 2, height: size.height / 2 },
      categories: [{ categoryName: 'person', score: 0.9 }],
    }], new Set(['person']), size.width, size.height, width, height)
    assert.ok(Math.abs(result.bbox.x - width / 4) < 1e-9)
    assert.ok(Math.abs(result.bbox.y - height / 4) < 1e-9)
    assert.ok(Math.abs(result.center.x - width / 2) < 1e-9)
    assert.ok(Math.abs(result.area - width * height / 4) < 1e-6)
  }
  assert.deepEqual(getInferenceSize(1280, 720), { width: 320, height: 180 })
  assert.deepEqual(getInferenceSize(160, 90), { width: 160, height: 90 })
  assert.throws(() => getInferenceSize(0, 720), RangeError)
})

test('時間統計は最新120結果に限定し、平均・nearest-rank p95を算出してリセットできる', () => {
  const timings = new ProcessingTimings(TIMING_LABELS)
  for (let i = 1; i <= TIMING_SAMPLE_LIMIT + 20; i++) {
    timings.add({ capture: i, roundTrip: 2 * i, inference: i, tracking: i, render: i, total: 3 * i })
  }
  const summary = timings.summarize()
  assert.equal(summary.capture.average, 80.5)
  assert.equal(summary.capture.p95, 134)
  assert.equal(summary.roundTrip.average, 161)
  assert.equal(summary.total.p95, 402)
  timings.reset()
  for (const key of Object.keys(TIMING_LABELS) as (keyof typeof TIMING_LABELS)[]) {
    assert.deepEqual(timings.summarize()[key], { average: 0, p95: 0 })
  }
})

test('推論解像度の全選択肢は縦横比を維持し、小さい入力は拡大しない', () => {
  assert.deepEqual(INFERENCE_LONG_EDGES, [320, 480, 640])
  for (const longEdge of INFERENCE_LONG_EDGES) {
    assert.ok(isInferenceLongEdge(longEdge))
    assert.deepEqual(getInferenceSize(1280, 720, longEdge), { width: longEdge, height: longEdge * 9 / 16 })
    assert.deepEqual(getInferenceSize(720, 1280, longEdge), { width: longEdge * 9 / 16, height: longEdge })
    assert.deepEqual(getInferenceSize(160, 90, longEdge), { width: 160, height: 90 })
  }
  assert.equal(isInferenceLongEdge(400), false)
  assert.throws(() => getInferenceSize(1280, 720, 400 as InferenceLongEdge), RangeError)
})

test('区間ごとの統計は独立し、再描画で推論のサンプルを増やさない', () => {
  const timings = new ProcessingTimings(TIMING_LABELS)
  timings.add({ inference: 90, total: 120 })
  for (let i = 1; i <= TIMING_SAMPLE_LIMIT; i++) timings.add({ render: i })
  timings.add({ inference: NaN, total: -1, render: Infinity })
  const summary = timings.summarize()
  assert.deepEqual(summary.inference, { average: 90, p95: 90 })
  assert.deepEqual(summary.total, { average: 120, p95: 120 })
  assert.deepEqual(summary.capture, { average: 0, p95: 0 })
  assert.deepEqual(summary.render, { average: 60.5, p95: 114 })
  timings.reset()
  timings.add({ render: 2 })
  assert.deepEqual(timings.summarize().render, { average: 2, p95: 2 })
  assert.deepEqual(timings.summarize().inference, { average: 0, p95: 0 })
})

test('EfficientDet-Lite2モデルの配布ファイルとURLを検証する', async () => {
  const models = [
    {
      configuration: 'lite2-cpu-int8',
      fileName: 'efficientdet-lite2-int8-v1.tflite',
      sha256: 'b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896',
    },
    {
      configuration: 'lite2-gpu-float16',
      fileName: 'efficientdet-lite2-float16-v1.tflite',
      sha256: '5d4ebec1029bc9907aeadb9e7b4ac9cb1da6a19d01ad375210a9ae18ba173302',
    },
  ] as const

  for (const model of models) {
    const contents = await readFile(new URL('../public/mediapipe/models/' + model.fileName, import.meta.url))
    assert.equal(contents.subarray(4, 8).toString(), 'TFL3')
    assert.equal(createHash('sha256').update(contents).digest('hex'), model.sha256)
    assert.deepEqual(resolveMediaPipeAssetUrls('/demo/', 'https://example.com', model.configuration), {
      modelUrl: 'https://example.com/demo/mediapipe/models/' + model.fileName,
      wasmRoot: 'https://example.com/demo/mediapipe/wasm',
    })
  }
})
