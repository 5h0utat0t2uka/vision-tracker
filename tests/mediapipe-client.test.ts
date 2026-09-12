import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { ObjectDetectorClient, type ObjectDetectorResult } from '../src/routes/mediapipe-tasks-vision/components/ObjectDetectorClient.ts'
import type { DetectorWorkerRequest, DetectorWorkerResponse } from '../src/routes/mediapipe-tasks-vision/components/protocol.ts'
import { resolveMediaPipeAssetUrls, type InferenceConfiguration, type DetectionCategory } from '../src/routes/mediapipe-tasks-vision/components/config.ts'

type FrameRequest = Extract<DetectorWorkerRequest, { type: 'frame' }>

function fixture(t: TestContext) {
  class FakeWorker extends EventTarget {
    sent: DetectorWorkerRequest[] = []
    transfers: Transferable[][] = []
    terminated = false
    postMessage(message: DetectorWorkerRequest, transfer: Transferable[] = []) {
      this.sent.push(message)
      this.transfers.push(transfer)
    }
    terminate() { this.terminated = true }
    reply(message: DetectorWorkerResponse) {
      this.dispatchEvent(new MessageEvent('message', { data: message }))
    }
  }
  const workers: FakeWorker[] = []
  const captures: { options: ImageBitmapOptions; bitmap: ImageBitmap; closed: boolean }[] = []
  let time = 0
  let captureDelay: Promise<void> | undefined
  const globals = {
    Worker: class extends FakeWorker {
      constructor() { super(); workers.push(this) }
    },
    window: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
    createImageBitmap: async (_video: HTMLVideoElement, options: ImageBitmapOptions) => {
      await captureDelay
      const entry = {
        options,
        closed: false,
        bitmap: { width: options.resizeWidth, height: options.resizeHeight, close() { entry.closed = true } } as ImageBitmap,
      }
      captures.push(entry)
      return entry.bitmap
    },
  }
  const restoreGlobals: (() => void)[] = []
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
    restoreGlobals.push(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  t.mock.method(performance, 'now', () => time)
  const results: ObjectDetectorResult[] = []
  const skipped: string[] = []
  const statuses: string[] = []
  const clients: { client: ObjectDetectorClient; worker: FakeWorker }[] = []
  const createClient = (inferenceConfiguration: InferenceConfiguration, categories: readonly DetectionCategory[] = ['person'], scoreThreshold = 0.7) => {
    const client = new ObjectDetectorClient({
      onResult: result => results.push(result),
      onStatusChange: status => statuses.push(status),
      onSkippedFrame: reason => skipped.push(reason),
    })
    const worker = workers.at(-1)!
    const assets = resolveMediaPipeAssetUrls('/', 'https://example.com', inferenceConfiguration)
    client.initialize(assets.modelUrl, assets.wasmRoot, categories, scoreThreshold, inferenceConfiguration)
    clients.push({ client, worker })
    return { client, worker }
  }
  const { client, worker } = createClient('lite0-cpu-int8')
  const init = worker.sent[0]
  assert.equal(init.type, 'init')
  worker.reply({ type: 'ready', configurationId: init.configurationId })
  const video = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
  const finish = (frame: FrameRequest) => worker.reply({
    type: 'result', generation: frame.generation, timestampMs: frame.timestampMs,
    width: frame.sourceWidth, height: frame.sourceHeight, detections: [], inferenceTimeMs: 20,
  })
  const frames = () => worker.sent.filter((message): message is FrameRequest => message.type === 'frame')
  t.after(() => {
    for (const { client, worker } of clients) {
      client.dispose()
      worker.reply({ type: 'disposed' })
    }
    for (const restore of restoreGlobals) restore()
  })
  return { client, worker, video, captures, results, skipped, statuses, finish, frames, createClient,
    setTime(value: number) { time = value },
    delayCapture(value: Promise<void>) { captureDelay = value },
  }
}

test('110msの非同期処理で実行枠を失わず、30fps入力・10fps設定で7.5fpsを処理する', async t => {
  const f = fixture(t)
  let pending: FrameRequest | undefined
  for (let i = 0; i < 300; i++) {
    const time = i * 1000 / 30
    f.setTime(time)
    if (pending && time >= pending.timestampMs + 110) {
      f.finish(pending)
      pending = undefined
    }
    await f.client.submitFrame(f.video, time, 10)
    pending ??= f.frames().at(-1)
  }
  assert.equal(f.frames().length, 75)
  assert.equal(f.captures.length, 75)
  assert.equal(f.skipped.filter(reason => reason === 'busy').length, 225)
})

test('正常なFPS間引きとbusyを分け、縮小画像を所有権転送する', async t => {
  const f = fixture(t)
  await f.client.submitFrame(f.video, 0, 10)
  await f.client.submitFrame(f.video, 33, 10)
  f.finish(f.frames()[0])
  await f.client.submitFrame(f.video, 66, 10)
  await f.client.submitFrame(f.video, 100, 10)
  assert.deepEqual(f.skipped, ['busy', 'rate-limit'])
  assert.equal(f.frames().length, 2)
  assert.deepEqual(f.captures[0].options, { resizeWidth: 320, resizeHeight: 180, resizeQuality: 'low' })
  assert.equal(f.frames()[0].sourceWidth, 1280)
  assert.equal(f.frames()[0].sourceHeight, 720)
  assert.equal(f.worker.transfers[1][0], f.captures[0].bitmap)
})

test('captureとWorker往復は同じmain-thread clockで独立して計測する', async t => {
  const f = fixture(t)
  let release!: () => void
  f.delayCapture(new Promise<void>(resolve => { release = resolve }))
  const capturing = f.client.submitFrame(f.video, 0, 10)
  f.setTime(5)
  release()
  await capturing
  f.setTime(35)
  f.finish(f.frames()[0])
  assert.equal(f.results[0].captureTimeMs, 5)
  assert.equal(f.results[0].roundTripTimeMs, 30)
  assert.equal(f.results[0].startedAtMs, 0)
  assert.equal(f.results[0].inferenceTimeMs, 20)
})

test('世代変更中のcaptureを解放し、古い推論結果を破棄して新しいsessionを開始する', async t => {
  const f = fixture(t)
  let release!: () => void
  f.delayCapture(new Promise<void>(resolve => { release = resolve }))
  const capturing = f.client.submitFrame(f.video, 0, 10)
  f.client.beginSession()
  release()
  await capturing
  assert.equal(f.captures[0].closed, true)
  assert.equal(f.frames().length, 0)
  await f.client.submitFrame(f.video, 10, 10)
  const stale = f.frames()[0]
  f.client.beginSession()
  f.finish(stale)
  assert.equal(f.results.length, 0)
  await f.client.submitFrame(f.video, 20, 10)
  f.finish(f.frames()[1])
  assert.equal(f.results.length, 1)
  assert.equal(f.results[0].timestampMs, 20)
})

test('設定変更中に停止・カメラ切替しても設定完了を受理して再開できる', async t => {
  const f = fixture(t)
  f.client.configure(['car'], 0.8)
  const request = f.worker.sent.at(-1)
  assert.equal(request?.type, 'configure')
  f.client.beginSession()
  f.client.beginSession()
  f.worker.reply({ type: 'configured', configurationId: request.configurationId })
  assert.deepEqual(f.statuses, ['loading', 'ready', 'loading', 'ready'])
  await f.client.submitFrame(f.video, 0, 10)
  assert.equal(f.frames().length, 1)
  f.finish(f.frames()[0])
  assert.equal(f.results.length, 1)
})

test('推論解像度の変更後は古い結果を破棄し、選択した寸法で転送する', async t => {
  const f = fixture(t)
  await f.client.submitFrame(f.video, 0, 10, 640)
  f.client.beginSession()
  f.finish(f.frames()[0])
  assert.equal(f.results.length, 0)
  await f.client.submitFrame(f.video, 100, 10, 320)
  assert.deepEqual(f.captures[1].options, { resizeWidth: 320, resizeHeight: 180, resizeQuality: 'low' })
  f.finish(f.frames()[1])
  assert.equal(f.results.length, 1)
  assert.equal(f.results[0].width, 1280)
  assert.equal(f.results[0].height, 720)
})

test('連続する設定変更では古い完了・エラーを無視し、現在の設定エラーは停止後も通知する', async t => {
  const f = fixture(t)
  f.client.configure(['car'], 0.8)
  const old = f.worker.sent.at(-1)
  assert.equal(old?.type, 'configure')
  f.client.configure(['person'], 0.6)
  const latest = f.worker.sent.at(-1)
  assert.equal(latest?.type, 'configure')
  f.client.beginSession()
  f.worker.reply({ type: 'configured', configurationId: old.configurationId })
  f.worker.reply({ type: 'error', scope: 'configuration', configurationId: old.configurationId, message: 'stale error' })
  await f.client.submitFrame(f.video, 0, 10)
  assert.equal(f.captures.length, 0)
  assert.equal(f.statuses.at(-1), 'loading')
  f.worker.reply({ type: 'error', scope: 'configuration', configurationId: latest.configurationId, message: 'current error' })
  assert.equal(f.statuses.at(-1), 'error')
  f.client.configure(['person'], 0.5)
  const retry = f.worker.sent.at(-1)
  assert.equal(retry?.type, 'configure')
  f.worker.reply({ type: 'configured', configurationId: retry.configurationId })
  await f.client.submitFrame(f.video, 1, 10)
  assert.equal(f.frames().length, 1)
})

test('モデル初期化中のセッション変更でreadyを失わず、dispose後の完了は無視する', async t => {
  const f = fixture(t)
  f.client.initialize('/model', '/wasm', ['person'], 0.7)
  const init = f.worker.sent.at(-1)
  assert.equal(init?.type, 'init')
  f.client.beginSession()
  f.worker.reply({ type: 'ready', configurationId: init.configurationId })
  assert.equal(f.statuses.at(-1), 'ready')
  f.client.configure(['person'], 0.8)
  const config = f.worker.sent.at(-1)
  assert.equal(config?.type, 'configure')
  const count = f.statuses.length
  f.client.dispose()
  f.worker.reply({ type: 'configured', configurationId: config.configurationId })
  assert.equal(f.statuses.length, count)
})

test('Lite0 CPUからLite2 GPUへの切り替えで設定を引き継ぎ、旧Workerの結果とエラーを無視する', async t => {
  const f = fixture(t)
  await f.client.submitFrame(f.video, 0, 10)
  f.client.dispose()
  const gpu = f.createClient('lite2-gpu-float16', ['car', 'bicycle'], 0.85)
  const init = gpu.worker.sent[0]
  assert.equal(init.type, 'init')
  assert.equal(init.inferenceConfiguration, 'lite2-gpu-float16')
  assert.ok(init.modelUrl.endsWith('efficientdet-lite2-float16-v1.tflite'))
  assert.deepEqual(init.categories, ['car', 'bicycle'])
  assert.equal(init.scoreThreshold, 0.85)
  const count = f.statuses.length
  f.finish(f.frames()[0])
  f.worker.reply({ type: 'error', scope: 'configuration', configurationId: 1, message: 'old error' })
  assert.equal(f.results.length, 0)
  assert.equal(f.statuses.length, count)
  await gpu.client.submitFrame(f.video, 100, 10)
  assert.equal(gpu.worker.sent.length, 1)
  gpu.client.beginSession() // Stop/camera switch while GPU initializes.
  gpu.worker.reply({ type: 'ready', configurationId: init.configurationId })
  assert.equal(f.statuses.at(-1), 'ready')
  await gpu.client.submitFrame(f.video, 200, 10)
  assert.equal(gpu.worker.sent.at(-1)?.type, 'frame')
  f.worker.reply({ type: 'disposed' })
  assert.equal(f.worker.terminated, true)
  assert.equal(gpu.worker.terminated, false)
})

test('GPU初期化の失敗と再切り替えから新しいCPU Workerで復帰できる', async t => {
  const f = fixture(t)
  f.client.dispose()
  const gpu = f.createClient('lite0-gpu-float16')
  gpu.worker.reply({ type: 'error', scope: 'configuration', configurationId: 1, message: 'GPU unavailable' })
  assert.equal(f.statuses.at(-1), 'error')
  await gpu.client.submitFrame(f.video, 0, 10)
  assert.equal(f.captures.length, 0)
  gpu.client.dispose()
  const cpu = f.createClient('lite0-cpu-int8', ['car'], 0.8)
  const count = f.statuses.length
  gpu.worker.reply({ type: 'ready', configurationId: 1 })
  assert.equal(f.statuses.length, count)
  cpu.worker.reply({ type: 'ready', configurationId: 1 })
  await cpu.client.submitFrame(f.video, 100, 10)
  assert.equal(cpu.worker.sent.at(-1)?.type, 'frame')
  const init = cpu.worker.sent[0]
  assert.equal(init.type, 'init')
  assert.equal(init.inferenceConfiguration, 'lite0-cpu-int8')
  assert.deepEqual(init.categories, ['car'])
  assert.equal(init.scoreThreshold, 0.8)
})

test('モデル切り替え中の画像取得を解放し、新Workerへ混入させない', async t => {
  const f = fixture(t)
  let release!: () => void
  f.delayCapture(new Promise<void>(resolve => { release = resolve }))
  const capture = f.client.submitFrame(f.video, 0, 10)
  f.client.dispose()
  const gpu = f.createClient('lite0-gpu-float16')
  gpu.worker.reply({ type: 'ready', configurationId: 1 })
  release()
  await capture
  assert.equal(f.captures[0].closed, true)
  assert.equal(f.frames().length, 0)
  await gpu.client.submitFrame(f.video, 100, 10)
  assert.equal(gpu.worker.sent.at(-1)?.type, 'frame')
})
