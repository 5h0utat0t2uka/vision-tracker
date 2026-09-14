import { Heatmap } from '../../shared/heatmap/Heatmap.ts'
import { HeatmapControls } from '../../shared/ui/heatmap'
import { Page, PageStage } from '../../shared/page'
import { Popover } from '../../shared/ui/popover'
import popoverStyles from '../../shared/ui/popover/index.module.css'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useCamera } from '../../hooks/useCamera.ts'
import type { CameraStatus } from '../../camera/CameraSession.ts'
import { BACKGROUND_TIMING_LABELS } from './components/TrackingEngine.ts'
import { useBackgroundTracking } from './hooks/useBackgroundTracking.ts'
import type { TrackingSettings } from './components/types.ts'
import {
  ANALYSIS_LONG_EDGES,
  DEFAULT_ANALYSIS_LONG_EDGE,
  isAnalysisLongEdge,
  type AnalysisLongEdge,
} from '../../shared/tracking/analysisConfig.ts'
import {
  CameraToggleButton,
  Metric,
  Metrics,
  GlobalControls,
  RegionEffectControl,
  RangeControl,
  SettingsIcon,
} from '../../shared/ui/copntrols'
import { CaptureButton } from '../../shared/ui/capture'

const DEFAULT_SETTINGS: TrackingSettings = {
  motionThreshold: 70,
  backgroundTimeConstantMs: 3300,
  minBlobAreaRatio: 0.02,
  maxMissingDurationMs: 300,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
  showTrail: true,
  regionEffect: 'none'
}

export function BackgroundSubtractionBlobTracker() {
  const [heatmap] = useState(() => new Heatmap())
  const videoRef = useRef<HTMLVideoElement>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null)
  const filterCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [targetFps, setTargetFps] = useState(30)
  const [analysisLongEdge, setAnalysisLongEdge] = useState<AnalysisLongEdge>(DEFAULT_ANALYSIS_LONG_EDGE)
  const camera = useCamera(videoRef)

  const { metrics, engineError, resetTimings } = useBackgroundTracking({
    videoRef, analysisCanvasRef, filterCanvasRef, overlayCanvasRef, stageRef,
    heatmap, cameraStatus: camera.status, stopCamera: camera.stop,
    settings, targetFps, analysisLongEdge,
  })

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
    <Page>
      <PageStage ref={stageRef} aria-label="カメラと追跡結果">
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

        <Metrics aria-label="Tracking metrics">
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
        </Metrics>
      </PageStage>

      <GlobalControls>
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
      </GlobalControls>

      {camera.status === 'running' && (
        <CaptureButton videoRef={videoRef} overlayRef={overlayCanvasRef} />
      )}

      <Popover id="tracking-settings" title="Setting">
        <HeatmapControls heatmap={heatmap} />

        <div className={popoverStyles.list}>
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
        <div className={popoverStyles.row}>
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
        <div className={popoverStyles.row}>
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
        <div className={popoverStyles.row}>
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

              resetTimings();
            }}
        />
        <div className={popoverStyles.row}>
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
          <p className={popoverStyles.error} role="alert">
            {camera.error ?? engineError}
          </p>
        )}
      </Popover>
    </Page>
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
