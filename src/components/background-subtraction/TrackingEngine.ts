import { BlobTracker } from '../shared/tracking/BlobTracker.ts'
import { OverlayRenderer } from '../shared/tracking/OverlayRenderer.ts'
import { MAX_FRAME_GAP_MS } from '../shared/tracking/timing.ts'
import { ProcessingTimings } from '../shared/ProcessingTimings.ts'
import { ConnectedComponents } from '../shared/tracking/ConnectedComponents.ts'
import { MotionDetector } from './MotionDetector.ts'
import type { TrackingSettings } from './types.ts'
import {
  DEFAULT_ANALYSIS_LONG_EDGE,
  OPENING_KERNEL_SIZES,
  isAnalysisLongEdge,
  getAnalysisSize,
  type AnalysisLongEdge,
} from '../shared/tracking/analysisConfig.ts'

export const BACKGROUND_TIMING_LABELS = {
  capture: 'CAPTURE',
  motion: 'BACKGROUND / OPENING',
  components: 'BLOB EXTRACTION',
  tracking: 'TRACKING TIME',
  render: 'DRAW SUBMISSION',
  total: 'PROCESSING',
} as const

export type FrameResult = {
  trackCount: number
  detectionCount: number
  isCalibrating: boolean
  foregroundRatio: number
}

type AnalysisPipeline = {
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  openingKernelSize: number
  motionDetector: MotionDetector
  connectedComponents: ConnectedComponents
  blobTracker: BlobTracker
}

const INITIAL_RESULT: FrameResult = {
  trackCount: 0,
  detectionCount: 0,
  isCalibrating: true,
  foregroundRatio: 0,
}

export class TrackingEngine {
  private readonly analysisCanvas: HTMLCanvasElement
  private readonly analysisContext: CanvasRenderingContext2D
  private readonly overlayRenderer: OverlayRenderer
  private pipeline: AnalysisPipeline | null = null
  private analysisLongEdge: AnalysisLongEdge = DEFAULT_ANALYSIS_LONG_EDGE
  private previousTimestampMs: number | null = null
  private lastResult: FrameResult = INITIAL_RESULT
  private readonly timings = new ProcessingTimings(BACKGROUND_TIMING_LABELS)

  getTimingSummary() {
    return this.timings.summarize()
  }

  resetTimings(): void {
    this.timings.reset()
  }

  constructor(
    analysisCanvas: HTMLCanvasElement,
    filterCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
  ) {
    this.analysisCanvas = analysisCanvas
    const analysisContext = analysisCanvas.getContext('2d', {
      willReadFrequently: true,
    })

    if (!analysisContext) {
      throw new Error('解析用Canvasを初期化できませんでした。')
    }

    this.analysisContext = analysisContext
    this.overlayRenderer = new OverlayRenderer(
      filterCanvas,
      overlayCanvas,
      1,
      1,
    )
  }

  resizeOverlay(width: number, height: number, pixelRatio: number): void {
    this.overlayRenderer.resize(width, height, pixelRatio)
  }

  reset(): void {
    this.resetTimings()
    this.pipeline?.motionDetector.reset()
    this.pipeline?.blobTracker.reset()
    this.overlayRenderer.clear()
    this.previousTimestampMs = null
    this.lastResult = INITIAL_RESULT
  }

  // Called on intrinsic video resize as well as before processing each frame.
  syncVideoSize(video: HTMLVideoElement, longEdge = this.analysisLongEdge): void {
    if (!isAnalysisLongEdge(longEdge)) {
      throw new RangeError('Invalid analysis resolution.')
    }
    this.analysisLongEdge = longEdge
    const { videoWidth: sourceWidth, videoHeight: sourceHeight } = video
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      this.pipeline = null
      this.reset()
      return
    }
    const { width, height } = getAnalysisSize(sourceWidth, sourceHeight, longEdge)
    const openingKernelSize = OPENING_KERNEL_SIZES[longEdge]
    if (
      this.pipeline?.sourceWidth === sourceWidth &&
      this.pipeline.sourceHeight === sourceHeight &&
      this.pipeline.width === width &&
      this.pipeline.height === height &&
      this.pipeline.openingKernelSize === openingKernelSize
    ) {
      return
    }
    this.analysisCanvas.width = width
    this.analysisCanvas.height = height
    this.pipeline = {
      width,
      height,
      sourceWidth,
      sourceHeight,
      openingKernelSize,
      motionDetector: new MotionDetector(width, height, openingKernelSize),
      connectedComponents: new ConnectedComponents(width, height),
      blobTracker: new BlobTracker(width, height),
    }
    this.overlayRenderer.setAnalysisSize(width, height)
    this.reset()
  }

  process(video: HTMLVideoElement, timestampMs: number, settings: TrackingSettings): FrameResult {
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('Invalid frame timestamp.')
    }
    this.syncVideoSize(video)
    const pipeline = this.pipeline
    if (!pipeline) return this.lastResult

    if (timestampMs === this.previousTimestampMs) return this.lastResult
    if (this.previousTimestampMs !== null && (
      timestampMs < this.previousTimestampMs ||
      timestampMs - this.previousTimestampMs > MAX_FRAME_GAP_MS
    )) {
      this.reset()
    }
    const elapsedMs = this.previousTimestampMs === null ? 0 : timestampMs - this.previousTimestampMs
    this.previousTimestampMs = timestampMs
    const startedAt = performance.now()
    this.analysisContext.drawImage(
      video,
      0,
      0,
      pipeline.width,
      pipeline.height,
    )
    const frame = this.analysisContext.getImageData(
      0,
      0,
      pipeline.width,
      pipeline.height,
    )
    const capturedAt = performance.now()
    const motion = pipeline.motionDetector.process(frame, elapsedMs, {
      threshold: settings.motionThreshold,
      backgroundTimeConstantMs: settings.backgroundTimeConstantMs,
    })
    const motionCompletedAt = performance.now()
    this.timings.add({ capture: capturedAt - startedAt, motion: motionCompletedAt - capturedAt })

    if (motion.isCalibrating) {
      pipeline.blobTracker.reset()
      this.overlayRenderer.clear()
      const clearedAt = performance.now()
      this.timings.add({ render: clearedAt - motionCompletedAt, total: clearedAt - startedAt })
      this.lastResult = {
        trackCount: 0,
        detectionCount: 0,
        isCalibrating: true,
        foregroundRatio: motion.foregroundRatio,
      }
      return this.lastResult
    }

    const minimumArea = Math.max(
      1,
      Math.round(
        pipeline.width *
          pipeline.height *
          settings.minBlobAreaRatio,
      ),
    )
    const componentsStartedAt = performance.now()
    const detections = pipeline.connectedComponents.extract(
      motion.mask,
      minimumArea,
    )
    const componentsCompletedAt = performance.now()
    const tracks = pipeline.blobTracker.update(detections, timestampMs, settings)
    const trackedAt = performance.now()
    this.overlayRenderer.render(tracks, video, {
      showTrail: settings.showTrail,
      regionEffect: settings.regionEffect,
    })
    const renderedAt = performance.now()
    this.timings.add({
      components: componentsCompletedAt - componentsStartedAt,
      tracking: trackedAt - componentsCompletedAt,
      render: renderedAt - trackedAt,
      total: renderedAt - startedAt,
    })

    this.lastResult = {
      trackCount: tracks.filter((track) => track.state === 'confirmed').length,
      detectionCount: detections.length,
      isCalibrating: false,
      foregroundRatio: motion.foregroundRatio,
    }
    return this.lastResult
  }
}
