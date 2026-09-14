import { Heatmap } from "../../shared/heatmap/Heatmap.ts";
import { HeatmapControls } from "../../shared/ui/heatmap";
import { Page, PageStage } from "../../shared/page";
import { Popover } from "../../shared/ui/popover";
import popoverStyles from "../../shared/ui/popover/index.module.css";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useCamera } from "../../hooks/useCamera.ts";
import { useColorTracking } from "./hooks/useColorTracking.ts";
import { getColorMode, hexToHsv, isHexColor } from "./lib/ColorDetector.ts";
import {
  COLOR_FPS_OPTIONS,
  COLOR_TIMING_LABELS,
  DEFAULT_COLOR_FPS,
  DEFAULT_COLOR_SETTINGS,
} from "./lib/config.ts";
import {
  ANALYSIS_LONG_EDGES,
  DEFAULT_ANALYSIS_LONG_EDGE,
  type AnalysisLongEdge,
} from "../../shared/tracking/analysisConfig.ts";
import { CaptureButton } from "../../shared/ui/capture";
import {
  CameraToggleButton,
  CameraSelectControl,
  NumericSelectControl,
  Metric,
  Metrics,
  GlobalControls,
  RegionEffectControl,
  RangeControl,
  SettingsIcon,
} from "../../shared/ui/controls";

export function ColorSegmentationBlobTracker() {
  const [heatmap] = useState(() => new Heatmap());
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const filterCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [settings, setSettings] = useState(DEFAULT_COLOR_SETTINGS);
  const [targetFps, setTargetFps] = useState(DEFAULT_COLOR_FPS);
  const [analysisLongEdge, setAnalysisLongEdge] = useState<AnalysisLongEdge>(
    DEFAULT_ANALYSIS_LONG_EDGE,
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const camera = useCamera(videoRef);
  const { metrics, engineReady, engineError, resetTimings } = useColorTracking({
    videoRef,
    analysisCanvasRef,
    filterCanvasRef,
    overlayCanvasRef,
    stageRef,
    heatmap,
    cameraStatus: camera.status,
    stopCamera: camera.stop,
    settings,
    targetFps,
    analysisLongEdge,
  });
  const colorMode = getColorMode(hexToHsv(settings.targetColor));

  const cameraActive =
    camera.status === "running" || camera.status === "suspended" || camera.status === "requesting";
  const statusText =
    engineError || camera.status === "error"
      ? "Error"
      : camera.status === "running"
        ? "Running"
        : camera.status === "requesting"
          ? "Requesting access"
          : camera.status === "suspended"
            ? "Camera interrupted"
            : "Idle";

  return (
    <Page>
      <PageStage ref={stageRef} aria-label="カメラと色領域の追跡結果">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
        <canvas
          ref={filterCanvasRef}
          className="filter-canvas"
          data-region-effect={settings.regionEffect}
          aria-hidden="true"
        />
        <canvas ref={overlayCanvasRef} aria-hidden="true" />
        <canvas ref={analysisCanvasRef} className="analysis-canvas" aria-hidden="true" />
        <Metrics aria-label="Color tracking metrics">
          <Metric label="TRACKS" value={metrics.trackCount.toString()} />
          <Metric label="MATCHED AREA" value={`${(metrics.matchedRatio * 100).toFixed(1)}%`} />
          <Metric label="ANALYSIS" value={`${metrics.analysisFps.toFixed(1)} FPS`} />
          {Object.entries(COLOR_TIMING_LABELS).map(([key, label]) => {
            const timing = metrics.timings[key as keyof typeof COLOR_TIMING_LABELS];
            return (
              <Metric
                key={key}
                label={`${label}·AVG / P95`}
                value={`${timing.average.toFixed(1)} / ${timing.p95.toFixed(1)} MS`}
              />
            );
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
        <button type="button" popoverTarget="color-settings" aria-label="Settings" title="Settings">
          <SettingsIcon />
        </button>
        <CameraToggleButton
          active={cameraActive}
          disabled={!engineReady}
          onStart={() => void camera.start(selectedDeviceId || undefined)}
          onStop={camera.stop}
        />
      </GlobalControls>

      {camera.status === "running" && (
        <CaptureButton videoRef={videoRef} overlayRef={overlayCanvasRef} />
      )}

      <Popover id="color-settings" title="Setting">
        <HeatmapControls heatmap={heatmap} />
        <div className={popoverStyles.list}>
          <RangeControl
            id="hue-tolerance"
            label="Hue tolerance"
            min={0}
            max={180}
            step={1}
            hint={
              colorMode === "chromatic"
                ? "大きいほど近い色相も検出"
                : "白・灰色・黒に近い色では色相を使いません"
            }
            disabled={colorMode !== "chromatic"}
            value={settings.hueTolerance}
            displayValue={`±${settings.hueTolerance}°`}
            onChange={(hueTolerance) => setSettings((current) => ({ ...current, hueTolerance }))}
          />
          <RangeControl
            id="saturation-tolerance"
            label="Saturation tolerance"
            min={0}
            max={100}
            step={1}
            hint={
              colorMode === "dark"
                ? "黒に近い色では明るさだけを使います"
                : "大きいほど鮮やかさの違いを許容"
            }
            disabled={colorMode === "dark"}
            value={settings.saturationTolerance * 100}
            displayValue={`±${Math.round(settings.saturationTolerance * 100)}%`}
            onChange={(percentage) =>
              setSettings((current) => ({ ...current, saturationTolerance: percentage / 100 }))
            }
          />
          <RangeControl
            id="value-tolerance"
            label="Value tolerance"
            min={0}
            max={100}
            step={1}
            hint="大きいほど明るさの違いを許容"
            value={settings.valueTolerance * 100}
            displayValue={`±${Math.round(settings.valueTolerance * 100)}%`}
            onChange={(percentage) =>
              setSettings((current) => ({ ...current, valueTolerance: percentage / 100 }))
            }
          />
          <RangeControl
            id="color-minimum-area"
            label="Minimum blob area"
            min={0.05}
            max={5}
            step={0.05}
            hint="小さいほど小さな色領域を検出"
            value={settings.minBlobAreaRatio * 100}
            displayValue={`${(settings.minBlobAreaRatio * 100).toFixed(2)}%`}
            onChange={(percentage) =>
              setSettings((current) => ({ ...current, minBlobAreaRatio: percentage / 100 }))
            }
          />
        </div>
        <div className={popoverStyles.row}>
          <label htmlFor="target-color">Target color</label>
          <input
            id="target-color"
            type="color"
            value={settings.targetColor}
            // aria-describedby="target-color-hint"
            onChange={(event) => {
              const value = event.target.value;
              if (isHexColor(value))
                setSettings((current) => ({ ...current, targetColor: value.toLowerCase() }));
            }}
          />
          {/*<output htmlFor="target-color">{settings.targetColor}</output>*/}
        </div>

        <CameraSelectControl
          id="color-camera"
          value={camera.info?.deviceId ?? selectedDeviceId}
          devices={camera.devices}
          onChange={(deviceId) => {
            setSelectedDeviceId(deviceId);
            if (cameraActive) void camera.start(deviceId || undefined);
          }}
        />
        <NumericSelectControl
          id="color-fps"
          label="Frame rate limit"
          value={targetFps}
          options={COLOR_FPS_OPTIONS}
          formatOption={(fps) => `${fps} fps`}
          onChange={(fps) => {
            setTargetFps(fps);
            resetTimings();
          }}
        />
        <NumericSelectControl
          id="color-resolution"
          label="Analysis resolution"
          value={analysisLongEdge}
          options={ANALYSIS_LONG_EDGES}
          formatOption={(edge) => `${edge} px`}
          onChange={setAnalysisLongEdge}
        />
        <RegionEffectControl
          id="color-region-effect"
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
          <label htmlFor="color-trail">Trail lines</label>
          <input
            id="color-trail"
            type="checkbox"
            checked={settings.showTrail}
            onChange={(event) => {
              const showTrail = event.target.checked;
              setSettings((current) => ({ ...current, showTrail }));
              resetTimings();
            }}
          />
        </div>

        {(camera.error || engineError) && (
          <p className={popoverStyles.error} role="alert">
            {camera.error ?? engineError}
          </p>
        )}
      </Popover>
    </Page>
  );
}
