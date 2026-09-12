import type { Detection } from '../../../shared/tracking/types.ts'
import type { DetectionCategory, InferenceConfiguration, InferenceLongEdge } from './config.ts'
import { DEFAULT_INFERENCE_CONFIGURATION, getInferenceSize } from './config.ts'
import { FrameScheduler } from '../../../shared/tracking/FrameScheduler.ts'
import type {
  DetectorWorkerRequest,
  DetectorWorkerResponse,
} from './protocol.ts'

export type ObjectDetectorResult = {
  timestampMs: number
  width: number
  height: number
  detections: Detection[]
  inferenceTimeMs: number
  captureTimeMs: number
  /** Main-thread send to receive; includes Worker scheduling, inference and conversion. */
  roundTripTimeMs: number
  /** Main-thread clock, for measuring capture through render submission. */
  startedAtMs: number
}

type ObjectDetectorClientCallbacks = {
  onStatusChange: (status: 'loading' | 'ready' | 'error', message?: string) => void
  onResult: (result: ObjectDetectorResult) => void
  onSkippedFrame: (reason: 'busy' | 'rate-limit') => void
}

export class ObjectDetectorClient {
  private readonly worker: Worker
  private readonly callbacks: ObjectDetectorClientCallbacks
  private generation = 0
  private configurationId = 0
  private ready = false
  private captureInFlight = false
  private inferenceInFlight = false
  private disposed = false
  private terminationTimer: number | null = null
  private readonly scheduler = new FrameScheduler()
  private pendingTiming: { startedAtMs: number; sentAtMs: number } | null = null

  constructor(callbacks: ObjectDetectorClientCallbacks) {
    this.callbacks = callbacks
    this.worker = new Worker(
      new URL('./object-detector.worker.ts', import.meta.url),
      { type: 'module' },
    )
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
  }

  initialize(
    modelUrl: string,
    wasmRoot: string,
    categories: readonly DetectionCategory[],
    scoreThreshold: number,
    inferenceConfiguration: InferenceConfiguration = DEFAULT_INFERENCE_CONFIGURATION,
  ): void {
    this.assertCategories(categories)
    this.nextGeneration()
    const configurationId = ++this.configurationId
    this.ready = false
    this.callbacks.onStatusChange('loading')
    this.post({
      type: 'init',
      inferenceConfiguration,
      configurationId,
      modelUrl,
      wasmRoot,
      categories,
      scoreThreshold,
    })
  }

  configure(categories: readonly DetectionCategory[], scoreThreshold: number): void {
    this.assertCategories(categories)
    this.nextGeneration()
    const configurationId = ++this.configurationId
    this.ready = false
    this.callbacks.onStatusChange('loading')
    this.post({ type: 'configure', configurationId, categories, scoreThreshold })
  }

  beginSession(): void {
    this.nextGeneration()
  }

  async submitFrame(video: HTMLVideoElement, timestampMs: number, targetFps: number, longEdge?: InferenceLongEdge): Promise<void> {
    if (this.disposed || !this.ready) return
    // Check capacity before consuming a scheduling deadline. No frame queue.
    if (this.captureInFlight || this.inferenceInFlight) {
      this.callbacks.onSkippedFrame('busy')
      return
    }
    if (!this.scheduler.shouldProcess(timestampMs, targetFps)) {
      this.callbacks.onSkippedFrame('rate-limit')
      return
    }

    const generation = this.generation
    this.captureInFlight = true
    let bitmap: ImageBitmap | null = null
    try {
      const startedAtMs = performance.now()
      const sourceWidth = video.videoWidth
      const sourceHeight = video.videoHeight
      const size = getInferenceSize(sourceWidth, sourceHeight, longEdge)
      bitmap = await createImageBitmap(video, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: 'low',
      })
      if (this.disposed || generation !== this.generation || !this.ready) {
        bitmap.close()
        return
      }
      this.inferenceInFlight = true
      this.pendingTiming = { startedAtMs, sentAtMs: performance.now() }
      this.worker.postMessage(
        { type: 'frame', generation, bitmap, timestampMs, sourceWidth, sourceHeight } satisfies DetectorWorkerRequest,
        [bitmap],
      )
      bitmap = null
    } catch (error) {
      bitmap?.close()
      this.inferenceInFlight = false
      this.pendingTiming = null
      if (!this.disposed && generation === this.generation) {
        this.callbacks.onStatusChange('error', errorMessage(error))
      }
    } finally {
      this.captureInFlight = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.nextGeneration()
    this.ready = false
    this.post({ type: 'dispose' })
    this.terminationTimer = window.setTimeout(() => this.terminate(), 1000)
  }

  private readonly handleMessage = (event: MessageEvent<DetectorWorkerResponse>): void => {
    const message = event.data
    if (message.type === 'disposed') {
      this.terminate()
      return
    }
    if (message.type === 'result') {
      const receivedAtMs = performance.now()
      const timing = this.pendingTiming
      this.pendingTiming = null
      this.inferenceInFlight = false
      if (!this.disposed && message.generation === this.generation && timing) {
        this.callbacks.onResult({
          ...message,
          startedAtMs: timing.startedAtMs,
          captureTimeMs: timing.sentAtMs - timing.startedAtMs,
          roundTripTimeMs: receivedAtMs - timing.sentAtMs,
        })
      }
      return
    }
    if (message.type === 'ready' || message.type === 'configured') {
      if (!this.disposed && message.configurationId === this.configurationId) {
        this.ready = true
        this.inferenceInFlight = false
        this.callbacks.onStatusChange('ready')
      }
      return
    }
    if (message.scope === 'dispose') {
      this.terminate()
      return
    }
    if (message.scope === 'frame') {
      this.inferenceInFlight = false
      this.pendingTiming = null
    }
    const current = message.scope === 'configuration'
      ? message.configurationId === this.configurationId
      : message.generation === this.generation
    if (!this.disposed && current) {
      this.ready = false
      this.callbacks.onStatusChange('error', message.message)
    }
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.inferenceInFlight = false
    this.pendingTiming = null
    this.ready = false
    if (!this.disposed) {
      this.callbacks.onStatusChange('error', event.message || 'Object Detector worker failed.')
    }
  }

  private nextGeneration(): number {
    this.scheduler.reset()
    this.generation += 1
    return this.generation
  }

  private post(message: DetectorWorkerRequest): void {
    if (!this.disposed || message.type === 'dispose') this.worker.postMessage(message)
  }

  private assertCategories(categories: readonly DetectionCategory[]): void {
    if (categories.length === 0) throw new RangeError('Select at least one detection category.')
  }

  private terminate(): void {
    if (this.terminationTimer !== null) window.clearTimeout(this.terminationTimer)
    this.terminationTimer = null
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    this.worker.terminate()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
