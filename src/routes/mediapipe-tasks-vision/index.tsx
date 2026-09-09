import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useCamera } from '../../hooks/useCamera.ts'
import { BlobTracker } from '../../components/shared/tracking/BlobTracker.ts'
import { OverlayRenderer } from '../../components/shared/tracking/OverlayRenderer.ts'
import type { TrackerSettings } from '../../components/shared/tracking/types.ts'
import type { RegionEffect } from '../../components/shared/rendering/regionEffect.ts';
import {
  CameraToggleButton,
  Metric,
  RegionEffectControl,
  RangeControl,
  SettingsIcon,
} from '../../components/shared/TrackerControls.tsx'
import {
  DEFAULT_DETECTION_CATEGORIES,
  DEFAULT_INFERENCE_BACKEND,
  INFERENCE_BACKENDS,
  isInferenceBackend,
  type InferenceBackend,
  DEFAULT_INFERENCE_FPS,
  DEFAULT_SCORE_THRESHOLD,
  DETECTION_CATEGORIES,
  INFERENCE_FPS_OPTIONS,
  INFERENCE_LONG_EDGE,
  INFERENCE_LONG_EDGES,
  isInferenceLongEdge,
  type InferenceLongEdge,
  METRICS_REPORT_INTERVAL_MS,
  TRACK_MISSING_TOLERANCE_MS,
  resolveMediaPipeAssetUrls,
  type DetectionCategory,
} from '../../components/mediapipe-tasks-vision/config.ts'
import {
  ObjectDetectorClient,
  type ObjectDetectorResult,
} from '../../components/mediapipe-tasks-vision/ObjectDetectorClient.ts'
import { ProcessingTimings } from '../../components/shared/ProcessingTimings.ts'
import { TIMING_LABELS, type TimingSummary } from '../../components/mediapipe-tasks-vision/timingConfig.ts'

const TRACKER_SETTINGS: TrackerSettings = {
  missingTimeBasis: 'first-miss',
  maxMissingDurationMs: TRACK_MISSING_TOLERANCE_MS,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
}

type DetectorStatus = 'loading' | 'ready' | 'error'

type MediaPipeMetrics = {
  cameraFps: number
  inferenceFps: number
  timings: TimingSummary
  detectionCount: number
  trackCount: number
  busyFrames: number
  rateLimitedFrames: number
}

const INITIAL_METRICS: MediaPipeMetrics = {
  cameraFps: 0,
  inferenceFps: 0,
  timings: new ProcessingTimings(TIMING_LABELS).summarize(),
  detectionCount: 0,
  trackCount: 0,
  busyFrames: 0,
  rateLimitedFrames: 0,
}

function createAccumulator() {
  return { cameraFrames: 0, inferenceFrames: 0, busyFrames: 0, rateLimitedFrames: 0, detectionCount: 0, trackCount: 0 }
}

export function MediaPipeTasksVisionObjectTracker() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const filterCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const rendererRef = useRef<OverlayRenderer | null>(null)
  const trackerRef = useRef<BlobTracker | null>(null)
  const pendingDrawRef = useRef<number | null>(null)
  const detectorRef = useRef<ObjectDetectorClient | null>(null)
  const sourceSizeRef = useRef({ width: 0, height: 0 })
  const showTrailRef = useRef(true)
  // const showGrayscaleRef = useRef(true)
  const regionEffectRef = useRef<RegionEffect>('grayscale')
  const inferenceFpsRef = useRef(DEFAULT_INFERENCE_FPS)
  const accumulatorRef = useRef(createAccumulator())
  const [timings] = useState(() => new ProcessingTimings(TIMING_LABELS))
  const initialConfigurationKey = `${DEFAULT_DETECTION_CATEGORIES.join(',')}:${DEFAULT_SCORE_THRESHOLD}`
  const previousConfigurationRef = useRef(initialConfigurationKey)
  const [categories, setCategories] = useState<DetectionCategory[]>([...DEFAULT_DETECTION_CATEGORIES])
  const [scoreThreshold, setScoreThreshold] = useState(DEFAULT_SCORE_THRESHOLD)
  const [backend, setBackend] = useState<InferenceBackend>(DEFAULT_INFERENCE_BACKEND)
  const configurationRef = useRef({ categories, scoreThreshold })
  const [inferenceFps, setInferenceFps] = useState(DEFAULT_INFERENCE_FPS)
  const [showTrail, setShowTrail] = useState(true)
  // const [showGrayscale, setShowGrayscale] = useState(true)
  const [regionEffect, setRegionEffect] = useState<RegionEffect>('grayscale')
  const [inferenceLongEdge, setInferenceLongEdge] = useState<InferenceLongEdge>(INFERENCE_LONG_EDGE)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [detectorStatus, setDetectorStatus] = useState<DetectorStatus>('loading')
  const [detectorError, setDetectorError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState(INITIAL_METRICS)
  const camera = useCamera(videoRef)

  showTrailRef.current = showTrail
  // showGrayscaleRef.current = showGrayscale
  regionEffectRef.current = regionEffect
  inferenceFpsRef.current = inferenceFps
  configurationRef.current = { categories, scoreThreshold }

  useEffect(() => {
    const filterCanvas = filterCanvasRef.current
    const overlayCanvas = overlayCanvasRef.current
    const stage = stageRef.current
    if (!filterCanvas || !overlayCanvas || !stage) return

    const renderer = new OverlayRenderer(filterCanvas, overlayCanvas, 1, 1)
    rendererRef.current = renderer
    const resize = () => {
      const bounds = stage.getBoundingClientRect()
      renderer.resize(bounds.width, bounds.height, window.devicePixelRatio)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(stage)
    resize()

    return () => {
      resizeObserver.disconnect()
      renderer.reset()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    // A fresh Worker isolates model/delegate resources and asynchronous results
    // from the previous backend, including failed GPU initialization.
    const configuration = configurationRef.current
    previousConfigurationRef.current = `${configuration.categories.join(',')}:${configuration.scoreThreshold}`
    trackerRef.current = null
    pendingDrawRef.current = null
    rendererRef.current?.clear()
    accumulatorRef.current = createAccumulator()
    timings.reset()
    setMetrics(INITIAL_METRICS)
    const detector = new ObjectDetectorClient({
      onStatusChange: (status, message) => {
        setDetectorStatus(status)
        setDetectorError(message ?? null)
      },
      onResult: handleResult,
      onSkippedFrame: (reason) => {
        if (reason === 'busy') accumulatorRef.current.busyFrames += 1
        else accumulatorRef.current.rateLimitedFrames += 1
      },
    })
    detectorRef.current = detector
    const assets = resolveMediaPipeAssetUrls(import.meta.env.BASE_URL, window.location.origin, backend)
    detector.initialize(
      assets.modelUrl,
      assets.wasmRoot,
      configuration.categories,
      configuration.scoreThreshold,
      backend,
    )

    return () => {
      detector.dispose()
      rendererRef.current?.reset()
      trackerRef.current = null
      pendingDrawRef.current = null
      detectorRef.current = null
    }
  }, [backend, timings])

  useEffect(() => {
    const configurationKey = `${categories.join(',')}:${scoreThreshold}`
    if (configurationKey === previousConfigurationRef.current) return
    const timer = window.setTimeout(() => {
      previousConfigurationRef.current = configurationKey
      trackerRef.current?.reset()
      pendingDrawRef.current = null
      rendererRef.current?.clear()
      accumulatorRef.current = createAccumulator()
      timings.reset()
      setMetrics(INITIAL_METRICS)
      detectorRef.current?.configure(categories, scoreThreshold)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [categories, scoreThreshold, backend, timings])

  useEffect(() => {
    const video = videoRef.current
    const detector = detectorRef.current
    if (camera.status !== 'running' || !video || !detector) {
      if (sourceSizeRef.current.width > 0) detector?.beginSession()
      sourceSizeRef.current = { width: 0, height: 0 }
      trackerRef.current?.reset()
      pendingDrawRef.current = null
      rendererRef.current?.clear()
      timings.reset()
      setMetrics(INITIAL_METRICS)
      return
    }
    if (detectorStatus !== 'ready') return
    if (typeof video.requestVideoFrameCallback !== 'function') {
      setDetectorStatus('error')
      setDetectorError('This browser does not support requestVideoFrameCallback().')
      camera.stop()
      return
    }

    let active = true
    let callbackId: number | null = null
    let lastReportAt = performance.now()

    const resetSource = () => {
      const width = video.videoWidth
      const height = video.videoHeight
      if (width <= 0 || height <= 0) return
      sourceSizeRef.current = { width, height }
      trackerRef.current = new BlobTracker(width, height)
      pendingDrawRef.current = null
      rendererRef.current?.setAnalysisSize(width, height)
      rendererRef.current?.clear()
      detector.beginSession()
      accumulatorRef.current = createAccumulator()
      timings.reset()
      lastReportAt = performance.now()
      setMetrics(INITIAL_METRICS)
    }

    const report = (now: number) => {
      const duration = now - lastReportAt
      if (duration < METRICS_REPORT_INTERVAL_MS) return
      const accumulator = accumulatorRef.current
      setMetrics({
        cameraFps: accumulator.cameraFrames * 1000 / duration,
        inferenceFps: accumulator.inferenceFrames * 1000 / duration,
        timings: timings.summarize(),
        detectionCount: accumulator.detectionCount,
        trackCount: accumulator.trackCount,
        busyFrames: accumulator.busyFrames,
        rateLimitedFrames: accumulator.rateLimitedFrames,
      })
      accumulator.cameraFrames = 0
      accumulator.inferenceFrames = 0
      lastReportAt = now
    }

    const processFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) return
      const size = sourceSizeRef.current
      if (video.videoWidth !== size.width || video.videoHeight !== size.height) resetSource()

      if (document.visibilityState === 'visible') {
        accumulatorRef.current.cameraFrames += 1
        void detector.submitFrame(video, metadata.presentationTime, inferenceFpsRef.current, inferenceLongEdge)
        // Observations update the tracker only in handleResult(). This redraws
        // the live video using the most recent boxes, independently of inference.
        const renderer = rendererRef.current
        if (renderer) {
          const startedAt = performance.now()
          try {
            // renderer.render(trackerRef.current?.getTracks() ?? [], video, showTrailRef.current, showGrayscaleRef.current)
            renderer.render(
              trackerRef.current?.getTracks() ?? [],
              video,
              {
                showTrail: showTrailRef.current,
                regionEffect: regionEffectRef.current,
              },
            )
          } catch (error) {
            active = false
            setDetectorError(error instanceof Error ? error.message : 'Failed to render tracking results.')
            camera.stop()
            return
          }
          const renderedAt = performance.now()
          timings.add({ render: renderedAt - startedAt })
          if (pendingDrawRef.current !== null) {
            timings.add({ total: renderedAt - pendingDrawRef.current })
            pendingDrawRef.current = null
          }
        }
        report(now)
      }
      callbackId = video.requestVideoFrameCallback(processFrame)
    }

    const handleVisibilityChange = () => {
      resetSource()
    }
    resetSource()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    video.addEventListener('resize', resetSource)
    callbackId = video.requestVideoFrameCallback(processFrame)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      video.removeEventListener('resize', resetSource)
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId)
      trackerRef.current?.reset()
      pendingDrawRef.current = null
      detector.beginSession()
      rendererRef.current?.reset()
    }
  }, [camera.status, camera.stop, detectorStatus, backend, timings, inferenceLongEdge])

  function handleResult(result: ObjectDetectorResult): void {
    const video = videoRef.current
    const renderer = rendererRef.current
    const tracker = trackerRef.current
    const expectedSize = sourceSizeRef.current
    if (!video || !renderer || !tracker ||
      result.width !== expectedSize.width || result.height !== expectedSize.height) return

    const trackingStartedAt = performance.now()
    const tracks = tracker.update(result.detections, result.timestampMs, TRACKER_SETTINGS)
    const trackedAt = performance.now()
    pendingDrawRef.current = result.startedAtMs
    timings.add({
      capture: result.captureTimeMs,
      roundTrip: result.roundTripTimeMs,
      inference: result.inferenceTimeMs,
      tracking: trackedAt - trackingStartedAt,
    })
    const accumulator = accumulatorRef.current
    accumulator.inferenceFrames += 1
    accumulator.detectionCount = result.detections.length
    accumulator.trackCount = tracks.filter((track) => track.state === 'confirmed').length
  }

  const toggleCategory = (category: DetectionCategory, selected: boolean) => {
    setCategories((current) => {
      if (selected) return current.includes(category) ? current : [...current, category]
      return current.length === 1 ? current : current.filter((value) => value !== category)
    })
  }
  const cameraActive = camera.status === 'running' || camera.status === 'suspended' || camera.status === 'requesting'
  const statusText = detectorStatus === 'loading'
    ? 'Loading model'
    : detectorStatus === 'error'
      ? 'Error'
      : camera.status === 'running'
        ? 'Running'
        : camera.status === 'error'
          ? 'Error'
        : camera.status === 'requesting'
          ? 'Requesting access'
          : camera.status === 'suspended'
            ? 'Camera interrupted'
            : 'Ready'

  return (
    <main className="tracker-app">
      <section className="video-stage" ref={stageRef} aria-label="カメラとAI追跡結果">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
        <canvas ref={filterCanvasRef} className="filter-canvas" data-region-effect={regionEffect} aria-hidden="true" />
        <canvas ref={overlayCanvasRef} aria-hidden="true" />

        <dl className="metrics" aria-label="AI tracking metrics">
          <Metric label="TRACKS" value={metrics.trackCount.toString()} />
          <Metric label="OBJECTS" value={metrics.detectionCount.toString()} />
          <Metric label="CAMERA" value={`${metrics.cameraFps.toFixed(1)} FPS`} />
          <Metric label="INFERENCE" value={`${metrics.inferenceFps.toFixed(1)} FPS`} />
          <Metric label="BUSY SKIPS" value={metrics.busyFrames.toString()} />
          <Metric label="RATE SKIPS" value={metrics.rateLimitedFrames.toString()} />
          {Object.entries(TIMING_LABELS).map(([key, label]) => {
            const timing = metrics.timings[key as keyof TimingSummary]
            return (
              <Metric
                key={key}
                label={`${label}·AVG / P95`}
                value={`${timing.average.toFixed(1)} / ${timing.p95.toFixed(1)} MS`}
              />
            )
          })}
        </dl>
      </section>

      <div className="global-controls">
        <div>
          <p aria-live="polite">Object Tracker: {statusText}</p>
          <Link to="/">← Back</Link>
        </div>
        <button type="button" popoverTarget="mediapipe-settings" aria-label="Settings" title={"Settings"}>
          <SettingsIcon />
        </button>
        <CameraToggleButton
          active={cameraActive}
          disabled={detectorStatus !== 'ready'}
          onStart={() => void camera.start(selectedDeviceId || undefined)}
          onStop={camera.stop}
        />
      </div>

      <aside id="mediapipe-settings" className="control-panel" aria-labelledby="mediapipe-settings-title" popover="auto">
        <div className="popover-heading">
          <h2 id="mediapipe-settings-title">Setting</h2>
          <button type="button" popoverTarget="mediapipe-settings" popoverTargetAction="hide" aria-label="設定を閉じる">
            <svg width={24} height={24} viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L17.94 6M18 18L6.06 6"></path></svg>
          </button>
        </div>

        <div className="control-list">
          <fieldset className="category-options">
            <legend>Detection targets</legend>
            {DETECTION_CATEGORIES.map((category) => (
              <label key={category.value}>
                <input
                  type="checkbox"
                  checked={categories.includes(category.value)}
                  disabled={categories.length === 1 && categories.includes(category.value)}
                  onChange={(event) => toggleCategory(category.value, event.target.checked)}
                />
                {category.label}
              </label>
            ))}
          </fieldset>

          <RangeControl
            id="confidence"
            label="Confidence"
            hint="推論結果の確度の閾値"
            min={0.1}
            max={0.9}
            step={0.05}
            value={scoreThreshold}
            displayValue={scoreThreshold.toFixed(2)}
            onChange={setScoreThreshold}
          />
        </div>

        <div className="option-row">
          <label htmlFor="inference-backend">Inference backend</label>
          <select id="inference-backend" value={backend} onChange={event => {
            const value = event.target.value
            if (isInferenceBackend(value)) setBackend(value)
          }}>
            {Object.entries(INFERENCE_BACKENDS).map(([value, option]) => (
              <option key={value} value={value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="option-row">
          <label htmlFor="camera-device">Camera</label>
          <select
            id="camera-device"
            value={camera.info?.deviceId ?? selectedDeviceId}
            onChange={(event) => {
              const deviceId = event.target.value
              setSelectedDeviceId(deviceId)
              if (cameraActive) void camera.start(deviceId || undefined)
            }}
          >
            <option value="">Default camera</option>
            {camera.devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div className="option-row">
          <label htmlFor="inference-rate">Inference FPS</label>
          <select id="inference-rate" value={inferenceFps} onChange={(event) => setInferenceFps(Number(event.target.value))}>
            {INFERENCE_FPS_OPTIONS.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
          </select>
        </div>


        <div className="option-row">
          <label htmlFor="inference-resolution">Inference resolution</label>
          <select id="inference-resolution" value={inferenceLongEdge} onChange={event => {
            const value = Number(event.target.value)
            if (isInferenceLongEdge(value)) setInferenceLongEdge(value)
          }}>
            {INFERENCE_LONG_EDGES.map(edge => <option key={edge} value={edge}>{edge} px</option>)}
          </select>
        </div>
        <RegionEffectControl
          id="mediapipe-region-effect"
          value={regionEffect}
          onChange={(nextRegionEffect) => {
            setRegionEffect(nextRegionEffect);
            timings.reset();
          }}
        />
        <div className="option-row">
          <label htmlFor="show-ai-trail">Trail lines</label>
          <input id="show-ai-trail" type="checkbox" checked={showTrail} onChange={(event) => setShowTrail(event.target.checked)} />
        </div>

        {(camera.error || detectorError) && <p className="error-message" role="alert">{camera.error ?? detectorError}</p>}
        {detectorStatus === 'error' && backend === 'gpu-float16' && (
          <button type="button" onClick={() => setBackend(DEFAULT_INFERENCE_BACKEND)}>Use CPU · int8</button>
        )}
      </aside>
    </main>
  )
}
