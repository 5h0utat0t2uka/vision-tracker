import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useCamera } from '../../hooks/useCamera.ts'
import type { CameraStatus } from '../../camera/CameraSession.ts'
import {
  TrackingEngine,
  BACKGROUND_TIMING_LABELS,
  type FrameResult,
} from '../../components/background-subtraction/TrackingEngine.ts'
import type { TrackingSettings } from '../../components/background-subtraction/types.ts'
import { FrameScheduler } from '../../components/shared/tracking/FrameScheduler.ts'
import {
  ANALYSIS_LONG_EDGES,
  DEFAULT_ANALYSIS_LONG_EDGE,
  isAnalysisLongEdge,
  type AnalysisLongEdge,
} from '../../components/shared/tracking/analysisConfig.ts'
import {
  CameraToggleButton,
  Metric,
  RegionEffectControl,
  RangeControl,
  SettingsIcon,
} from '../../components/shared/TrackerControls.tsx'
import { CaptureButton } from '../../components/shared/CaptureButton.tsx'
import { ProcessingTimings, type TimingSummary } from '../../components/shared/ProcessingTimings.ts'

const DEFAULT_SETTINGS: TrackingSettings = {
  motionThreshold: 70,
  backgroundTimeConstantMs: 3300,
  minBlobAreaRatio: 0.02,
  maxMissingDurationMs: 300,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
  showTrail: true,
  regionEffect: 'grayscale'
}

type RuntimeMetrics = FrameResult & {
  analysisFps: number
  timings: TimingSummary<keyof typeof BACKGROUND_TIMING_LABELS>
  missedVideoFrames: number
}

const INITIAL_METRICS: RuntimeMetrics = {
  trackCount: 0,
  detectionCount: 0,
  isCalibrating: false,
  foregroundRatio: 0,
  analysisFps: 0,
  timings: new ProcessingTimings(BACKGROUND_TIMING_LABELS).summarize(),
  missedVideoFrames: 0,
}

export function BackgroundSubtractionBlobTracker() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null)
  const filterCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<TrackingEngine | null>(null)
  const settingsRef = useRef(DEFAULT_SETTINGS)
  const targetFpsRef = useRef(30)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [targetFps, setTargetFps] = useState(30)
  const [analysisLongEdge, setAnalysisLongEdge] = useState<AnalysisLongEdge>(DEFAULT_ANALYSIS_LONG_EDGE)
  const [metrics, setMetrics] = useState(INITIAL_METRICS)
  const [engineError, setEngineError] = useState<string | null>(null)
  const camera = useCamera(videoRef)

  settingsRef.current = settings
  targetFpsRef.current = targetFps

  useEffect(() => {
    const analysisCanvas = analysisCanvasRef.current
    const filterCanvas = filterCanvasRef.current
    const overlayCanvas = overlayCanvasRef.current
    const stage = stageRef.current

    if (!analysisCanvas || !filterCanvas || !overlayCanvas || !stage) {
      return
    }

    const engine = new TrackingEngine(
      analysisCanvas,
      filterCanvas,
      overlayCanvas,
    )
    engineRef.current = engine

    const resize = () => {
      const bounds = stage.getBoundingClientRect()
      engine.resizeOverlay(bounds.width, bounds.height, window.devicePixelRatio)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(stage)
    resize()

    return () => {
      resizeObserver.disconnect()
      engine.reset()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    const engine = engineRef.current

    if (camera.status !== 'running' || !video || !engine) {
      engine?.reset()
      setMetrics(INITIAL_METRICS)
      return
    }

    if (typeof video.requestVideoFrameCallback !== 'function') {
      setEngineError('このブラウザは映像フレーム解析APIに対応していません。')
      camera.stop()
      return
    }

    let active = true
    let callbackId: number | null = null
    const scheduler = new FrameScheduler()
    let lastReportAt = performance.now()
    let lastPresentedFrames: number | null = null
    let processedFrames = 0
    let missedVideoFrames = 0
    let latestResult: FrameResult = {
      trackCount: 0,
      detectionCount: 0,
      isCalibrating: true,
      foregroundRatio: 0,
    }

    const resetProcessing = () => {
      scheduler.reset()
      engine.reset()
      lastReportAt = performance.now()
      lastPresentedFrames = null
      processedFrames = 0
      missedVideoFrames = 0
      latestResult = { ...INITIAL_METRICS, isCalibrating: true }
      setMetrics({ ...INITIAL_METRICS, isCalibrating: true })
    }
    const handleVideoResize = () => {
      engine.syncVideoSize(video, analysisLongEdge)
      resetProcessing()
    }

    const processFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) {
        return
      }

      if (document.visibilityState !== 'visible') {
        callbackId = video.requestVideoFrameCallback(processFrame)
        return
      }

      if (lastPresentedFrames !== null) {
        missedVideoFrames += Math.max(
          0,
          metadata.presentedFrames - lastPresentedFrames - 1,
        )
      }
      lastPresentedFrames = metadata.presentedFrames

      // presentationTime is a per-frame timestamp in milliseconds, unlike
      // mediaTime (seconds, potentially zero for live streams).
      try {
        if (scheduler.shouldProcess(metadata.presentationTime, targetFpsRef.current)) {
          latestResult = engine.process(video, metadata.presentationTime, settingsRef.current)
          processedFrames += 1
        }
      } catch (error) {
        active = false
        setEngineError(
          error instanceof Error
            ? error.message
            : 'Unknown error occurred during tracking.',
        )
        camera.stop()
        return
      }

      const reportDuration = now - lastReportAt
      if (reportDuration >= 500) {
        setMetrics({
          ...latestResult,
          analysisFps: (processedFrames * 1000) / reportDuration,
          timings: engine.getTimingSummary(),
          missedVideoFrames,
        })
        lastReportAt = now
        processedFrames = 0
      }
      callbackId = video.requestVideoFrameCallback(processFrame)
    }

    setEngineError(null)
    engine.syncVideoSize(video, analysisLongEdge)
    resetProcessing()
    document.addEventListener('visibilitychange', resetProcessing)
    video.addEventListener('resize', handleVideoResize)
    callbackId = video.requestVideoFrameCallback(processFrame)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', resetProcessing)
      video.removeEventListener('resize', handleVideoResize)
      if (callbackId !== null) {
        video.cancelVideoFrameCallback(callbackId)
      }
      engine.reset()
    }
  }, [camera.status, camera.stop, analysisLongEdge])

  const statusText = getStatusText(camera.status, metrics.isCalibrating)
  const cameraActive = camera.status === 'running' || camera.status === 'suspended' || camera.status === 'requesting'
  // const cameraDescription = camera.info
  //   ? [
  //       camera.info.width && camera.info.height
  //         ? `${camera.info.width}×${camera.info.height}`
  //         : null,
  //       camera.info.frameRate
  //         ? `${camera.info.frameRate.toFixed(0)} fps`
  //         : null,
  //       camera.info.facingMode ?? null,
  //     ]
  //       .filter(Boolean)
  //       .join(' / ')
  //   : null

  return (
    <main className="tracker-app">
      <section className="video-stage" ref={stageRef} aria-label="カメラと追跡結果">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
        <canvas
          ref={filterCanvasRef}
          className="filter-canvas"
          data-region-effect={settings.regionEffect}
          aria-hidden="true"
        />
        <canvas ref={overlayCanvasRef} aria-hidden="true" />
        <canvas
          ref={analysisCanvasRef}
          className="analysis-canvas"
          aria-hidden="true"
        />

        {/*{camera.status !== 'running' && (
          <div className="stage-placeholder">
            <p>右上のアイコンからカメラを開始</p>
            <span>映像と解析内容は外部に送信されません</span>
          </div>
        )}*/}

        <dl className="metrics" aria-label="Tracking metrics">
          <Metric label="TRACKS" value={metrics.trackCount.toString()} />
          <Metric
            label="MOTION"
            value={`${(metrics.foregroundRatio * 100).toFixed(1)}%`}
          />
          <Metric
            label="ANALYSIS"
            value={`${metrics.analysisFps.toFixed(1)} FPS`}
          />
          {Object.entries(BACKGROUND_TIMING_LABELS).map(([key, label]) => {
            const timing = metrics.timings[key as keyof typeof BACKGROUND_TIMING_LABELS]
            return <Metric key={key} label={`${label}·AVG / P95`} value={`${timing.average.toFixed(1)} / ${timing.p95.toFixed(1)} MS`} />
          })}
          <Metric label="BLOBS" value={metrics.detectionCount.toString()} />
          <Metric label="DROPPED" value={metrics.missedVideoFrames.toString()} />
        </dl>
      </section>

      <div className='global-controls'>
        <div>
          <p aria-live="polite">Blob Tracker: {statusText}</p>
          <Link to="/">← Back</Link>
        </div>
        <button
          type="button"
          popoverTarget="tracking-settings"
          aria-label="Settings"
          title={"Settings"}
        >
          <SettingsIcon />
        </button>
        <CameraToggleButton
          active={camera.status === 'running' || camera.status === 'suspended' || camera.status === 'requesting'}
          onStart={() => void camera.start(selectedDeviceId || undefined)}
          onStop={camera.stop}
        />
      </div>

      {camera.status === 'running' && (
        <CaptureButton videoRef={videoRef} overlayRef={overlayCanvasRef} />
      )}

      <aside
        id="tracking-settings"
        className="control-panel"
        aria-labelledby="settings-title"
        popover="auto"
      >
        <div className="popover-heading">
          <h2 id="settings-title">Setting</h2>
          <button
            type="button"
            popoverTarget="tracking-settings"
            popoverTargetAction="hide"
            aria-label="設定を閉じる"
          >
            <svg width={24} height={24} viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L17.94 6M18 18L6.06 6"></path></svg>
          </button>
        </div>

        <div className="control-list">
          <RangeControl
            id="motion-threshold"
            label="Motion threshold"
            hint="小さいほどわずかな変化も検出"
            min={5}
            max={80}
            step={1}
            value={settings.motionThreshold}
            displayValue={settings.motionThreshold.toString()}
            onChange={(motionThreshold) =>
              setSettings((current) => ({ ...current, motionThreshold }))
            }
          />
          <RangeControl
            id="minimum-blob-area"
            label="Minimum blob area"
            hint="小さいほど小さな動体を検出"
            min={0.05}
            max={5}
            step={0.05}
            value={settings.minBlobAreaRatio * 100}
            displayValue={`${(settings.minBlobAreaRatio * 100).toFixed(2)}%`}
            onChange={(percentage) =>
              setSettings((current) => ({
                ...current,
                minBlobAreaRatio: percentage / 100,
              }))
            }
          />
          <RangeControl
            id="background-adaptation-time"
            label="Background adaptation time"
            hint="小さいほど変化へ速く適応"
            min={0.5}
            max={30}
            step={0.1}
            value={settings.backgroundTimeConstantMs / 1000}
            displayValue={`${(settings.backgroundTimeConstantMs / 1000).toFixed(1)} s`}
            onChange={(seconds) =>
              setSettings((current) => ({
                ...current,
                backgroundTimeConstantMs: seconds * 1000,
              }))
            }
          />
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
          <label htmlFor="analysis-rate">Frame rate limit</label>
          <select
            id="analysis-rate"
            value={targetFps}
            onChange={(event) => setTargetFps(Number(event.target.value))}
          >
            <option value={30}>30 fps</option>
            <option value={20}>20 fps</option>
            <option value={15}>15 fps</option>
          </select>
        </div>
        <div className="option-row">
          <label htmlFor="analysis-resolution">Analysis resolution</label>
          <select
            id="analysis-resolution"
            value={analysisLongEdge}
            // aria-describedby="analysis-resolution-hint"
            onChange={(event) => {
              const value = Number(event.target.value)
              if (isAnalysisLongEdge(value)) setAnalysisLongEdge(value)
            }}
          >
            {ANALYSIS_LONG_EDGES.map((longEdge) => (
              <option key={longEdge} value={longEdge}>{longEdge} px</option>
            ))}
          </select>
        </div>
        {/*<small id="analysis-resolution-hint">
          解析する長辺の画素数で、大きいほど細部を解析し処理負荷が増加します。
        </small>*/}
        <RegionEffectControl
          id="background-region-effect"
          value={settings.regionEffect}
            onChange={(regionEffect) => {
              setSettings((current) => ({
                ...current,
                regionEffect,
              }));

              engineRef.current?.resetTimings();
            }}
        />
        <div className="option-row">
          <label htmlFor="show-trail">Trail lines</label>
          <input
            id="show-trail"
            type="checkbox"
            checked={settings.showTrail}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                showTrail: event.target.checked,
              }))
            }
          />
        </div>

        {(camera.error || engineError) && (
          <p className="error-message" role="alert">
            {camera.error ?? engineError}
          </p>
        )}
      </aside>
    </main>
  )
}

function getStatusText(
  status: CameraStatus,
  isCalibrating: boolean,
): string {
  if (status === 'requesting') {
    return 'Requesting access'
  }
  if (status === 'suspended') {
    return 'Camera interrupted'
  }
  if (status === 'running' && isCalibrating) {
    return 'Initialize'
  }
  if (status === 'running') {
    return 'Running'
  }
  if (status === 'error') {
    return 'Error'
  }
  return 'Idle'
}
