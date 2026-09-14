import { Heatmap } from "../../shared/heatmap/Heatmap.ts";
import { HeatmapControls } from "../../shared/ui/heatmap";
import { Page, PageStage } from "../../shared/page";
import { Popover } from "../../shared/ui/popover";
import popoverStyles from "../../shared/ui/popover/index.module.css";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useCamera } from "../../hooks/useCamera.ts";
import { useMediaPipeTracking } from "./hooks/useMediaPipeTracking.ts";
import type { RegionEffect } from "../../shared/rendering/regionEffect.ts";
import {
  CameraToggleButton,
  Metric,
  Metrics,
  GlobalControls,
  RegionEffectControl,
  RangeControl,
  SettingsIcon,
} from "../../shared/ui/copntrols";
import {
  DEFAULT_DETECTION_CATEGORIES,
  DEFAULT_INFERENCE_CONFIGURATION,
  INFERENCE_CONFIGURATIONS,
  isInferenceConfiguration,
  type InferenceConfiguration,
  DEFAULT_INFERENCE_FPS,
  DEFAULT_SCORE_THRESHOLD,
  DETECTION_CATEGORIES,
  INFERENCE_FPS_OPTIONS,
  DEFAULT_INFERENCE_LONG_EDGE,
  INFERENCE_LONG_EDGES,
  isInferenceLongEdge,
  type InferenceLongEdge,
  type DetectionCategory,
} from "./components/config.ts";
import { CaptureButton } from "../../shared/ui/capture";
import { TIMING_LABELS, type TimingSummary } from "./components/timingConfig.ts";

export function MediaPipeTasksVisionObjectTracker() {
  const [heatmap] = useState(() => new Heatmap());
  const videoRef = useRef<HTMLVideoElement>(null);
  const filterCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [categories, setCategories] = useState<DetectionCategory[]>([
    ...DEFAULT_DETECTION_CATEGORIES,
  ]);
  const [scoreThreshold, setScoreThreshold] = useState(DEFAULT_SCORE_THRESHOLD);
  const [inferenceConfiguration, setInferenceConfiguration] = useState<InferenceConfiguration>(
    DEFAULT_INFERENCE_CONFIGURATION,
  );
  const [inferenceFps, setInferenceFps] = useState(DEFAULT_INFERENCE_FPS);
  const [showTrail, setShowTrail] = useState(true);
  // const [showGrayscale, setShowGrayscale] = useState(true)
  const [regionEffect, setRegionEffect] = useState<RegionEffect>("none");
  const [inferenceLongEdge, setInferenceLongEdge] = useState<InferenceLongEdge>(
    DEFAULT_INFERENCE_LONG_EDGE,
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const camera = useCamera(videoRef);

  const { metrics, detectorStatus, detectorError, resetTimings } = useMediaPipeTracking({
    videoRef,
    filterCanvasRef,
    overlayCanvasRef,
    stageRef,
    heatmap,
    cameraStatus: camera.status,
    stopCamera: camera.stop,
    categories,
    scoreThreshold,
    inferenceConfiguration,
    inferenceFps,
    inferenceLongEdge,
    showTrail,
    regionEffect,
  });

  const toggleCategory = (category: DetectionCategory, selected: boolean) => {
    setCategories((current) => {
      if (selected) return current.includes(category) ? current : [...current, category];
      return current.length === 1 ? current : current.filter((value) => value !== category);
    });
  };
  const changeInferenceConfiguration = (nextConfiguration: InferenceConfiguration) => {
    setInferenceConfiguration(nextConfiguration);
    setInferenceLongEdge(INFERENCE_CONFIGURATIONS[nextConfiguration].recommendedLongEdge);
  };
  const cameraActive =
    camera.status === "running" || camera.status === "suspended" || camera.status === "requesting";
  const recommendedInferenceLongEdge =
    INFERENCE_CONFIGURATIONS[inferenceConfiguration].recommendedLongEdge;
  const statusText =
    detectorStatus === "loading"
      ? "Loading model"
      : detectorStatus === "error"
        ? "Error"
        : camera.status === "running"
          ? "Running"
          : camera.status === "error"
            ? "Error"
            : camera.status === "requesting"
              ? "Requesting access"
              : camera.status === "suspended"
                ? "Camera interrupted"
                : "Ready";

  return (
    <Page>
      <PageStage ref={stageRef} aria-label="カメラとAI追跡結果">
        <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
        <canvas
          ref={filterCanvasRef}
          className="filter-canvas"
          data-region-effect={regionEffect}
          aria-hidden="true"
        />
        <canvas ref={overlayCanvasRef} aria-hidden="true" />

        <Metrics aria-label="AI tracking metrics">
          <Metric label="TRACKS" value={metrics.trackCount.toString()} />
          <Metric label="OBJECTS" value={metrics.detectionCount.toString()} />
          <Metric label="CAMERA" value={`${metrics.cameraFps.toFixed(1)} FPS`} />
          <Metric label="INFERENCE" value={`${metrics.inferenceFps.toFixed(1)} FPS`} />
          <Metric label="BUSY SKIPS" value={metrics.busyFrames.toString()} />
          <Metric label="RATE SKIPS" value={metrics.rateLimitedFrames.toString()} />
          {Object.entries(TIMING_LABELS).map(([key, label]) => {
            const timing = metrics.timings[key as keyof TimingSummary];
            return (
              <Metric
                key={key}
                label={`${label}·AVG / P95`}
                value={`${timing.average.toFixed(1)} / ${timing.p95.toFixed(1)} MS`}
              />
            );
          })}
        </Metrics>
      </PageStage>

      <GlobalControls>
        <div>
          <p aria-live="polite">Object Tracker: {statusText}</p>
          <Link to="/">← Back</Link>
        </div>
        <button
          type="button"
          popoverTarget="mediapipe-settings"
          aria-label="Settings"
          title={"Settings"}
        >
          <SettingsIcon />
        </button>
        <CameraToggleButton
          active={cameraActive}
          disabled={detectorStatus !== "ready"}
          onStart={() => void camera.start(selectedDeviceId || undefined)}
          onStop={camera.stop}
        />
      </GlobalControls>

      {camera.status === "running" && (
        <CaptureButton videoRef={videoRef} overlayRef={overlayCanvasRef} />
      )}

      <Popover id="mediapipe-settings" title="Setting">
        <HeatmapControls heatmap={heatmap} />
        <div className={popoverStyles.list}>
          <fieldset className={popoverStyles.categories}>
            <legend>Detection</legend>
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
        <div className={popoverStyles.row}>
          <label htmlFor="inference-configuration">Inference model</label>
          <select
            id="inference-configuration"
            value={inferenceConfiguration}
            onChange={(event) => {
              const value = event.target.value;
              if (isInferenceConfiguration(value)) changeInferenceConfiguration(value);
            }}
          >
            {Object.entries(INFERENCE_CONFIGURATIONS).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={popoverStyles.row}>
          <label htmlFor="camera-device">Camera</label>
          <select
            id="camera-device"
            value={camera.info?.deviceId ?? selectedDeviceId}
            onChange={(event) => {
              const deviceId = event.target.value;
              setSelectedDeviceId(deviceId);
              if (cameraActive) void camera.start(deviceId || undefined);
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
          <label htmlFor="inference-rate">Inference FPS</label>
          <select
            id="inference-rate"
            value={inferenceFps}
            onChange={(event) => setInferenceFps(Number(event.target.value))}
          >
            {INFERENCE_FPS_OPTIONS.map((fps) => (
              <option key={fps} value={fps}>
                {fps} fps
              </option>
            ))}
          </select>
        </div>

        <div className={popoverStyles.row}>
          <label htmlFor="inference-resolution">Inference resolution</label>
          <select
            id="inference-resolution"
            value={inferenceLongEdge}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (isInferenceLongEdge(value)) setInferenceLongEdge(value);
            }}
          >
            {INFERENCE_LONG_EDGES.map((edge) => (
              <option key={edge} value={edge}>
                {edge} px{edge === recommendedInferenceLongEdge ? " · Recommended" : ""}
              </option>
            ))}
          </select>
        </div>
        <RegionEffectControl
          id="mediapipe-region-effect"
          value={regionEffect}
          onChange={(nextRegionEffect) => {
            setRegionEffect(nextRegionEffect);
            resetTimings();
          }}
        />
        <div className={popoverStyles.row}>
          <label htmlFor="show-ai-trail">Trail lines</label>
          <input
            id="show-ai-trail"
            type="checkbox"
            checked={showTrail}
            onChange={(event) => setShowTrail(event.target.checked)}
          />
        </div>

        {(camera.error || detectorError) && (
          <p className={popoverStyles.error} role="alert">
            {camera.error ?? detectorError}
          </p>
        )}
        {detectorStatus === "error" &&
          INFERENCE_CONFIGURATIONS[inferenceConfiguration].delegate === "GPU" && (
            <button
              type="button"
              onClick={() => changeInferenceConfiguration(DEFAULT_INFERENCE_CONFIGURATION)}
            >
              Use EfficientDet-Lite0 · CPU · int8
            </button>
          )}
      </Popover>
    </Page>
  );
}
