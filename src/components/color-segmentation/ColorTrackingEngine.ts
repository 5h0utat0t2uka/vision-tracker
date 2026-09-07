import { BlobTracker } from '../shared/tracking/BlobTracker.ts'
import { ConnectedComponents } from '../shared/tracking/ConnectedComponents.ts'
import { OverlayRenderer } from '../shared/tracking/OverlayRenderer.ts'
import { MAX_FRAME_GAP_MS } from '../shared/tracking/timing.ts'
import { DEFAULT_ANALYSIS_LONG_EDGE, OPENING_KERNEL_SIZES, getAnalysisSize, isAnalysisLongEdge, type AnalysisLongEdge } from '../shared/tracking/analysisConfig.ts'
import { ProcessingTimings } from '../shared/ProcessingTimings.ts'
import { ColorDetector } from './ColorDetector.ts'
import { COLOR_TIMING_LABELS, type ColorTrackingSettings } from './config.ts'

export type ColorFrameResult = { trackCount: number; detectionCount: number; matchedRatio: number }
export const INITIAL_COLOR_RESULT: ColorFrameResult = { trackCount: 0, detectionCount: 0, matchedRatio: 0 }

type ColorPipeline = {
  sourceWidth: number
  sourceHeight: number
  width: number
  height: number
  kernelSize: number
  detector: ColorDetector
  components: ConnectedComponents
  tracker: BlobTracker
}

export class ColorTrackingEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly renderer: OverlayRenderer
  private readonly timings = new ProcessingTimings(COLOR_TIMING_LABELS)
  private pipeline: ColorPipeline | null = null
  private longEdge: AnalysisLongEdge = DEFAULT_ANALYSIS_LONG_EDGE
  private previousTimestamp: number | null = null
  private settingsKey = ''
  private lastResult = INITIAL_COLOR_RESULT

  constructor(analysisCanvas: HTMLCanvasElement, filterCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) {
    const context = analysisCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })
    if (!context) throw new Error('Failed to initialize the color analysis canvas.')
    this.canvas = analysisCanvas
    this.context = context
    this.renderer = new OverlayRenderer(filterCanvas, overlayCanvas, 1, 1)
  }

  resizeOverlay(width: number, height: number, pixelRatio: number): void {
    this.renderer.resize(width, height, pixelRatio)
  }

  getTimingSummary() { return this.timings.summarize() }
  resetTimings(): void { this.timings.reset() }

  reset(): void {
    this.pipeline?.tracker.reset()
    this.renderer.clear()
    this.timings.reset()
    this.previousTimestamp = null
    this.lastResult = INITIAL_COLOR_RESULT
  }

  syncVideoSize(video: HTMLVideoElement, longEdge = this.longEdge): void {
    if (!isAnalysisLongEdge(longEdge)) throw new RangeError('Invalid analysis resolution.')
    this.longEdge = longEdge
    const { videoWidth: sourceWidth, videoHeight: sourceHeight } = video
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      this.pipeline = null
      this.reset()
      return
    }
    const { width, height } = getAnalysisSize(sourceWidth, sourceHeight, longEdge)
    const kernelSize = OPENING_KERNEL_SIZES[longEdge]
    if (this.pipeline?.sourceWidth === sourceWidth && this.pipeline.sourceHeight === sourceHeight && this.pipeline.width === width && this.pipeline.height === height && this.pipeline.kernelSize === kernelSize) return
    this.canvas.width = width
    this.canvas.height = height
    this.pipeline = {
      sourceWidth, sourceHeight, width, height, kernelSize,
      detector: new ColorDetector(width, height, kernelSize),
      components: new ConnectedComponents(width, height),
      tracker: new BlobTracker(width, height),
    }
    this.renderer.setAnalysisSize(width, height)
    this.reset()
  }

  process(video: HTMLVideoElement, timestampMs: number, settings: ColorTrackingSettings): ColorFrameResult {
    if (!Number.isFinite(timestampMs)) throw new RangeError('Invalid frame timestamp.')
    if (!Number.isFinite(settings.minBlobAreaRatio) || settings.minBlobAreaRatio < 0 || settings.minBlobAreaRatio > 1) {
      throw new RangeError('Invalid minimum blob area.')
    }
    this.syncVideoSize(video)
    const pipeline = this.pipeline
    if (!pipeline) return this.lastResult
    const key = `${settings.targetColor}:${settings.hueTolerance}:${settings.saturationTolerance}:${settings.valueTolerance}:${settings.minBlobAreaRatio}`
    if (key !== this.settingsKey) {
      this.settingsKey = key
      this.reset()
    }
    if (timestampMs === this.previousTimestamp) return this.lastResult
    if (this.previousTimestamp !== null && (timestampMs < this.previousTimestamp || timestampMs - this.previousTimestamp > MAX_FRAME_GAP_MS)) this.reset()
    this.previousTimestamp = timestampMs
    const startedAt = performance.now()
    // Always read the original video, never the grayscale display canvas.
    this.context.drawImage(video, 0, 0, pipeline.width, pipeline.height)
    const frame = this.context.getImageData(0, 0, pipeline.width, pipeline.height)
    const capturedAt = performance.now()
    const color = pipeline.detector.process(frame, settings)
    const segmentedAt = performance.now()
    const detections = pipeline.components.extract(color.mask, Math.max(1, Math.round(pipeline.width * pipeline.height * settings.minBlobAreaRatio)))
    const extractedAt = performance.now()
    const tracks = pipeline.tracker.update(detections, timestampMs, settings)
    const trackedAt = performance.now()
    this.renderer.render(tracks, video, {
      showTrail: settings.showTrail,
      regionEffect: settings.regionEffect,
    })
    const renderedAt = performance.now()
    this.timings.add({
      capture: capturedAt - startedAt,
      segmentation: segmentedAt - capturedAt,
      components: extractedAt - segmentedAt,
      tracking: trackedAt - extractedAt,
      render: renderedAt - trackedAt,
      total: renderedAt - startedAt,
    })
    this.lastResult = {
      trackCount: tracks.filter(track => track.state === 'confirmed').length,
      detectionCount: detections.length,
      matchedRatio: color.matchedRatio,
    }
    return this.lastResult
  }
}
