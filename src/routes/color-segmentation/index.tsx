import { Page, PageStage } from '../../shared/page'
import { Popover } from '../../shared/ui/popover'
import popoverStyles from '../../shared/ui/popover/index.module.css'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useCamera } from '../../hooks/useCamera.ts'
import { ColorTrackingEngine, INITIAL_COLOR_RESULT } from './components/ColorTrackingEngine.ts'
import { getColorMode, hexToHsv, isHexColor } from './components/ColorDetector.ts'
import { COLOR_FPS_OPTIONS, COLOR_METRICS_INTERVAL_MS, COLOR_TIMING_LABELS, DEFAULT_COLOR_FPS, DEFAULT_COLOR_SETTINGS } from './components/config.ts'
import { FrameScheduler } from '../../shared/tracking/FrameScheduler.ts'
import { ANALYSIS_LONG_EDGES, DEFAULT_ANALYSIS_LONG_EDGE, isAnalysisLongEdge, type AnalysisLongEdge } from '../../shared/tracking/analysisConfig.ts'
import { ProcessingTimings } from '../../shared/ProcessingTimings.ts'
import { CaptureButton } from '../../shared/ui/capture'
import { CameraToggleButton, Metric, Metrics, GlobalControls, RegionEffectControl, RangeControl, SettingsIcon } from '../../shared/ui/copntrols'

const INITIAL_METRICS = {
  ...INITIAL_COLOR_RESULT,
  analysisFps: 0,
  missedVideoFrames: 0,
  timings: new ProcessingTimings(COLOR_TIMING_LABELS).summarize(),
}

export function ColorSegmentationBlobTracker() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const analysisRef = useRef<HTMLCanvasElement>(null)
  const filterRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const engineRef = useRef<ColorTrackingEngine | null>(null)
  const [settings, setSettings] = useState(DEFAULT_COLOR_SETTINGS)
  const [targetFps, setTargetFps] = useState(DEFAULT_COLOR_FPS)
  const [longEdge, setLongEdge] = useState<AnalysisLongEdge>(DEFAULT_ANALYSIS_LONG_EDGE)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [metrics, setMetrics] = useState(INITIAL_METRICS)
  const [engineReady, setEngineReady] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const settingsRef = useRef(settings)
  const fpsRef = useRef(targetFps)
  const camera = useCamera(videoRef)
  settingsRef.current = settings
  fpsRef.current = targetFps
  const detectionKey = `${settings.targetColor}:${settings.hueTolerance}:${settings.saturationTolerance}:${settings.valueTolerance}:${settings.minBlobAreaRatio}`
  const colorMode = getColorMode(hexToHsv(settings.targetColor))

  useEffect(() => {
    const analysis = analysisRef.current
    const filter = filterRef.current
    const overlay = overlayRef.current
    const stage = stageRef.current
    if (!analysis || !filter || !overlay || !stage) return
    let engine: ColorTrackingEngine
    try {
      engine = new ColorTrackingEngine(analysis, filter, overlay)
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : 'Failed to initialize color tracking.')
      return
    }
    engineRef.current = engine
    setEngineReady(true)
    const resize = () => {
      const bounds = stage.getBoundingClientRect()
      engine.resizeOverlay(bounds.width, bounds.height, window.devicePixelRatio)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()
    return () => {
      observer.disconnect()
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
      setEngineError('This browser does not support requestVideoFrameCallback().')
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
    let result = INITIAL_COLOR_RESULT
    const resetProcessing = () => {
      engine.reset()
      scheduler.reset()
      lastReportAt = performance.now()
      lastPresentedFrames = null
      processedFrames = 0
      missedVideoFrames = 0
      result = INITIAL_COLOR_RESULT
      setMetrics(INITIAL_METRICS)
    }
    const resizeSource = () => {
      engine.syncVideoSize(video, longEdge)
      resetProcessing()
    }
    const processFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) return
      if (document.visibilityState === 'visible') {
        if (lastPresentedFrames !== null) missedVideoFrames += Math.max(0, metadata.presentedFrames - lastPresentedFrames - 1)
        lastPresentedFrames = metadata.presentedFrames
        try {
          if (scheduler.shouldProcess(metadata.presentationTime, fpsRef.current)) {
            result = engine.process(video, metadata.presentationTime, settingsRef.current)
            processedFrames++
          }
        } catch (error) {
          active = false
          setEngineError(error instanceof Error ? error.message : 'Failed to analyze color regions.')
          camera.stop()
          return
        }
        const duration = now - lastReportAt
        if (duration >= COLOR_METRICS_INTERVAL_MS) {
          setMetrics({ ...result, analysisFps: processedFrames * 1000 / duration, missedVideoFrames, timings: engine.getTimingSummary() })
          lastReportAt = now
          processedFrames = 0
        }
      }
      callbackId = video.requestVideoFrameCallback(processFrame)
    }
    setEngineError(null)
    resizeSource()
    document.addEventListener('visibilitychange', resetProcessing)
    video.addEventListener('resize', resizeSource)
    callbackId = video.requestVideoFrameCallback(processFrame)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', resetProcessing)
      video.removeEventListener('resize', resizeSource)
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId)
      engine.reset()
    }
  }, [camera.status, camera.stop, longEdge, detectionKey])

  const cameraActive = camera.status === 'running' || camera.status === 'suspended' || camera.status === 'requesting'
  const statusText = engineError || camera.status === 'error' ? 'Error'
    : camera.status === 'running' ? 'Running'
    : camera.status === 'requesting' ? 'Requesting access'
    : camera.status === 'suspended' ? 'Camera interrupted' : 'Idle'

  return (
    <Page>
      <PageStage ref={stageRef} aria-label="カメラと色領域の追跡結果">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
        <canvas ref={filterRef} className="filter-canvas" data-region-effect={settings.regionEffect} aria-hidden="true" />
        <canvas ref={overlayRef} aria-hidden="true" />
        <canvas ref={analysisRef} className="analysis-canvas" aria-hidden="true" />
        <Metrics aria-label="Color tracking metrics">
          <Metric label="TRACKS" value={metrics.trackCount.toString()} />
          <Metric label="MATCHED AREA" value={`${(metrics.matchedRatio * 100).toFixed(1)}%`} />
          <Metric label="ANALYSIS" value={`${metrics.analysisFps.toFixed(1)} FPS`} />
          {Object.entries(COLOR_TIMING_LABELS).map(([key, label]) => {
            const timing = metrics.timings[key as keyof typeof COLOR_TIMING_LABELS]
            return <Metric key={key} label={`${label}·AVG / P95`} value={`${timing.average.toFixed(1)} / ${timing.p95.toFixed(1)} MS`} />
          })}
          <Metric label="BLOBS" value={metrics.detectionCount.toString()} />
          <Metric label="DROPPED" value={metrics.missedVideoFrames.toString()} />
        </Metrics>
      </PageStage>

      <GlobalControls>
        <div>
          <p aria-live="polite">Color Tracker: {statusText}</p>
          <Link to="/">← Back</Link>
        </div>
        <button type="button" popoverTarget="color-settings" aria-label="Settings" title="Settings"><SettingsIcon /></button>
        <CameraToggleButton
          active={cameraActive}
          disabled={!engineReady}
          onStart={() => void camera.start(selectedDeviceId || undefined)}
          onStop={camera.stop}
        />
      </GlobalControls>

      {camera.status === 'running' && (
        <CaptureButton videoRef={videoRef} overlayRef={overlayRef} />
      )}

      <Popover id="color-settings" title="Setting">
        <div className={popoverStyles.list}>
          <RangeControl id="hue-tolerance" label="Hue tolerance" min={0} max={180} step={1}
            hint={colorMode === 'chromatic' ? '大きいほど近い色相も検出' : '白・灰色・黒に近い色では色相を使いません'}
            disabled={colorMode !== 'chromatic'} value={settings.hueTolerance} displayValue={`±${settings.hueTolerance}°`}
            onChange={hueTolerance => setSettings(current => ({ ...current, hueTolerance }))} />
          <RangeControl id="saturation-tolerance" label="Saturation tolerance" min={0} max={100} step={1}
            hint={colorMode === 'dark' ? '黒に近い色では明るさだけを使います' : '大きいほど鮮やかさの違いを許容'}
            disabled={colorMode === 'dark'} value={settings.saturationTolerance * 100} displayValue={`±${Math.round(settings.saturationTolerance * 100)}%`}
            onChange={percentage => setSettings(current => ({ ...current, saturationTolerance: percentage / 100 }))} />
          <RangeControl id="value-tolerance" label="Value tolerance" min={0} max={100} step={1} hint="大きいほど明るさの違いを許容"
            value={settings.valueTolerance * 100} displayValue={`±${Math.round(settings.valueTolerance * 100)}%`}
            onChange={percentage => setSettings(current => ({ ...current, valueTolerance: percentage / 100 }))} />
          <RangeControl id="color-minimum-area" label="Minimum blob area" min={0.05} max={5} step={0.05} hint="小さいほど小さな色領域を検出"
            value={settings.minBlobAreaRatio * 100} displayValue={`${(settings.minBlobAreaRatio * 100).toFixed(2)}%`}
            onChange={percentage => setSettings(current => ({ ...current, minBlobAreaRatio: percentage / 100 }))} />
        </div>
        <div className={popoverStyles.row}>
          <label htmlFor="target-color">Target color</label>
          <input id="target-color" type="color" value={settings.targetColor} aria-describedby="target-color-hint" onChange={event => {
            const value = event.target.value
            if (isHexColor(value)) setSettings(current => ({ ...current, targetColor: value.toLowerCase() }))
          }} />
          {/*<output htmlFor="target-color">{settings.targetColor}</output>*/}
        </div>

        <div className={popoverStyles.row}>
          <label htmlFor="color-camera">Camera</label>
          <select id="color-camera" value={camera.info?.deviceId ?? selectedDeviceId} onChange={event => {
            const deviceId = event.target.value
            setSelectedDeviceId(deviceId)
            if (cameraActive) void camera.start(deviceId || undefined)
          }}>
            <option value="">Default camera</option>
            {camera.devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        </div>
        <div className={popoverStyles.row}>
          <label htmlFor="color-fps">Frame rate limit</label>
          <select id="color-fps" value={targetFps} onChange={event => { setTargetFps(Number(event.target.value)); engineRef.current?.resetTimings() }}>
            {COLOR_FPS_OPTIONS.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
          </select>
        </div>
        <div className={popoverStyles.row}>
          <label htmlFor="color-resolution">Analysis resolution</label>
          <select id="color-resolution" value={longEdge} onChange={event => {
            const value = Number(event.target.value)
            if (isAnalysisLongEdge(value)) setLongEdge(value)
          }}>
            {ANALYSIS_LONG_EDGES.map(edge => <option key={edge} value={edge}>{edge} px</option>)}
          </select>
        </div>
        <RegionEffectControl
          id="color-region-effect"
          value={settings.regionEffect}
          onChange={(regionEffect) => {
            setSettings((current) => ({
              ...current,
              regionEffect,
            }));
            engineRef.current?.resetTimings();
          }}
        />

        <div className={popoverStyles.row}>
          <label htmlFor="color-trail">Trail lines</label>
          <input id="color-trail" type="checkbox" checked={settings.showTrail} onChange={event => {
            const showTrail = event.target.checked
            setSettings(current => ({ ...current, showTrail }))
            engineRef.current?.resetTimings()
          }} />
        </div>

        {(camera.error || engineError) && <p className={popoverStyles.error} role="alert">{camera.error ?? engineError}</p>}
      </Popover>
    </Page>
  )
}
