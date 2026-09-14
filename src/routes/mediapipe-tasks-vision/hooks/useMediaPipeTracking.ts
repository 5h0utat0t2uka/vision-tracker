import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { CameraStatus } from "../../../camera/CameraSession.ts";
import type { Heatmap } from "../../../shared/heatmap/Heatmap.ts";
import { ProcessingTimings } from "../../../shared/ProcessingTimings.ts";
import { BlobTracker } from "../../../shared/tracking/BlobTracker.ts";
import { OverlayRenderer } from "../../../shared/tracking/OverlayRenderer.ts";
import type { TrackerSettings } from "../../../shared/tracking/types.ts";
import type { RegionEffect } from "../../../shared/rendering/regionEffect.ts";
import {
  ObjectDetectorClient,
  type ObjectDetectorResult,
} from "../components/ObjectDetectorClient.ts";
import {
  METRICS_REPORT_INTERVAL_MS,
  TRACK_MISSING_TOLERANCE_MS,
  resolveMediaPipeAssetUrls,
  type DetectionCategory,
  type InferenceConfiguration,
  type InferenceLongEdge,
} from "../components/config.ts";
import { TIMING_LABELS, type TimingSummary } from "../components/timingConfig.ts";

const TRACKER_SETTINGS: TrackerSettings = {
  missingTimeBasis: "first-miss",
  maxMissingDurationMs: TRACK_MISSING_TOLERANCE_MS,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
};

type DetectorStatus = "loading" | "ready" | "error";

type MediaPipeMetrics = {
  cameraFps: number;
  inferenceFps: number;
  timings: TimingSummary;
  detectionCount: number;
  trackCount: number;
  busyFrames: number;
  rateLimitedFrames: number;
};

const INITIAL_METRICS: MediaPipeMetrics = {
  cameraFps: 0,
  inferenceFps: 0,
  timings: new ProcessingTimings(TIMING_LABELS).summarize(),
  detectionCount: 0,
  trackCount: 0,
  busyFrames: 0,
  rateLimitedFrames: 0,
};

function createAccumulator() {
  return {
    cameraFrames: 0,
    inferenceFrames: 0,
    busyFrames: 0,
    rateLimitedFrames: 0,
    detectionCount: 0,
    trackCount: 0,
  };
}

type MediaPipeTrackingOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  filterCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  heatmap: Heatmap;
  cameraStatus: CameraStatus;
  stopCamera: () => void;
  categories: readonly DetectionCategory[];
  scoreThreshold: number;
  inferenceConfiguration: InferenceConfiguration;
  inferenceFps: number;
  inferenceLongEdge: InferenceLongEdge;
  showTrail: boolean;
  regionEffect: RegionEffect;
};

export function useMediaPipeTracking({
  videoRef,
  filterCanvasRef,
  overlayCanvasRef,
  stageRef,
  heatmap,
  cameraStatus,
  stopCamera,
  categories,
  scoreThreshold,
  inferenceConfiguration,
  inferenceFps,
  inferenceLongEdge,
  showTrail,
  regionEffect,
}: MediaPipeTrackingOptions) {
  const rendererRef = useRef<OverlayRenderer | null>(null);
  const trackerRef = useRef<BlobTracker | null>(null);
  const pendingDrawRef = useRef<number | null>(null);
  const detectorRef = useRef<ObjectDetectorClient | null>(null);
  const sourceSizeRef = useRef({ width: 0, height: 0 });
  const accumulatorRef = useRef(createAccumulator());
  const [timings] = useState(() => new ProcessingTimings(TIMING_LABELS));
  const previousConfigurationRef = useRef<string | null>(null);
  const [detectorStatus, setDetectorStatus] = useState<DetectorStatus>("loading");
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const resetTimings = useCallback(() => timings.reset(), [timings]);
  // These reads do not recreate the Worker or restart the frame loop.
  // Detection settings still have their own reactive, debounced Effect below.
  const readConfiguration = useEffectEvent(() => ({ categories, scoreThreshold }));
  const readFrameSettings = useEffectEvent(() => ({ inferenceFps, showTrail, regionEffect }));

  const handleResult = useEffectEvent((result: ObjectDetectorResult): void => {
    const video = videoRef.current;
    const renderer = rendererRef.current;
    const tracker = trackerRef.current;
    const expectedSize = sourceSizeRef.current;
    if (
      !video ||
      !renderer ||
      !tracker ||
      result.width !== expectedSize.width ||
      result.height !== expectedSize.height
    )
      return;

    const trackingStartedAt = performance.now();
    const tracks = tracker.update(result.detections, result.timestampMs, TRACKER_SETTINGS);
    heatmap.observe(tracks, result.timestampMs, result.width, result.height);
    const trackedAt = performance.now();
    pendingDrawRef.current = result.startedAtMs;
    timings.add({
      capture: result.captureTimeMs,
      roundTrip: result.roundTripTimeMs,
      inference: result.inferenceTimeMs,
      tracking: trackedAt - trackingStartedAt,
    });
    const accumulator = accumulatorRef.current;
    accumulator.inferenceFrames += 1;
    accumulator.detectionCount = result.detections.length;
    accumulator.trackCount = tracks.filter((track) => track.state === "confirmed").length;
  });

  useEffect(() => {
    const filterCanvas = filterCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const stage = stageRef.current;
    if (!filterCanvas || !overlayCanvas || !stage) return;

    const renderer = new OverlayRenderer(filterCanvas, overlayCanvas, 1, 1, heatmap);
    rendererRef.current = renderer;
    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height, window.devicePixelRatio);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();

    return () => {
      resizeObserver.disconnect();
      renderer.reset();
      rendererRef.current = null;
    };
  }, [heatmap, filterCanvasRef, overlayCanvasRef, stageRef]);

  useEffect(() => {
    // A fresh Worker isolates model/delegate resources and asynchronous results
    // from the previous model configuration, including failed GPU initialization.
    const configuration = readConfiguration();
    previousConfigurationRef.current = `${configuration.categories.join(",")}:${configuration.scoreThreshold}`;
    trackerRef.current = null;
    pendingDrawRef.current = null;
    rendererRef.current?.clear();
    accumulatorRef.current = createAccumulator();
    timings.reset();
    setMetrics(INITIAL_METRICS);
    const detector = new ObjectDetectorClient({
      onStatusChange: (status, message) => {
        setDetectorStatus(status);
        setDetectorError(message ?? null);
      },
      onResult: handleResult,
      onSkippedFrame: (reason) => {
        if (reason === "busy") accumulatorRef.current.busyFrames += 1;
        else accumulatorRef.current.rateLimitedFrames += 1;
      },
    });
    detectorRef.current = detector;
    const assets = resolveMediaPipeAssetUrls(
      import.meta.env.BASE_URL,
      window.location.origin,
      inferenceConfiguration,
    );
    detector.initialize(
      assets.modelUrl,
      assets.wasmRoot,
      configuration.categories,
      configuration.scoreThreshold,
      inferenceConfiguration,
    );

    return () => {
      detector.dispose();
      rendererRef.current?.reset();
      trackerRef.current = null;
      pendingDrawRef.current = null;
      detectorRef.current = null;
    };
  }, [inferenceConfiguration, timings]);

  useEffect(() => {
    const configurationKey = `${categories.join(",")}:${scoreThreshold}`;
    if (configurationKey === previousConfigurationRef.current) return;
    const timer = window.setTimeout(() => {
      previousConfigurationRef.current = configurationKey;
      trackerRef.current?.reset();
      pendingDrawRef.current = null;
      rendererRef.current?.reset();
      accumulatorRef.current = createAccumulator();
      timings.reset();
      setMetrics(INITIAL_METRICS);
      detectorRef.current?.configure(categories, scoreThreshold);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [categories, scoreThreshold, inferenceConfiguration, timings]);

  useEffect(() => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (cameraStatus !== "running" || !video || !detector) {
      if (sourceSizeRef.current.width > 0) detector?.beginSession();
      sourceSizeRef.current = { width: 0, height: 0 };
      trackerRef.current?.reset();
      pendingDrawRef.current = null;
      rendererRef.current?.clear();
      timings.reset();
      setMetrics(INITIAL_METRICS);
      return;
    }
    if (detectorStatus !== "ready") return;
    if (typeof video.requestVideoFrameCallback !== "function") {
      setDetectorStatus("error");
      setDetectorError("This browser does not support requestVideoFrameCallback().");
      stopCamera();
      return;
    }

    let active = true;
    let callbackId: number | null = null;
    let lastReportAt = performance.now();

    const resetSource = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width <= 0 || height <= 0) return;
      sourceSizeRef.current = { width, height };
      trackerRef.current = new BlobTracker(width, height);
      pendingDrawRef.current = null;
      rendererRef.current?.setAnalysisSize(width, height);
      rendererRef.current?.clear();
      detector.beginSession();
      accumulatorRef.current = createAccumulator();
      timings.reset();
      lastReportAt = performance.now();
      setMetrics(INITIAL_METRICS);
    };

    const report = (now: number) => {
      const duration = now - lastReportAt;
      if (duration < METRICS_REPORT_INTERVAL_MS) return;
      const accumulator = accumulatorRef.current;
      setMetrics({
        cameraFps: (accumulator.cameraFrames * 1000) / duration,
        inferenceFps: (accumulator.inferenceFrames * 1000) / duration,
        timings: timings.summarize(),
        detectionCount: accumulator.detectionCount,
        trackCount: accumulator.trackCount,
        busyFrames: accumulator.busyFrames,
        rateLimitedFrames: accumulator.rateLimitedFrames,
      });
      accumulator.cameraFrames = 0;
      accumulator.inferenceFrames = 0;
      lastReportAt = now;
    };

    const processFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) return;
      const size = sourceSizeRef.current;
      if (video.videoWidth !== size.width || video.videoHeight !== size.height) resetSource();

      if (document.visibilityState === "visible") {
        accumulatorRef.current.cameraFrames += 1;
        const current = readFrameSettings();
        void detector.submitFrame(
          video,
          metadata.presentationTime,
          current.inferenceFps,
          inferenceLongEdge,
        );
        // Observations update the tracker only in handleResult(). This redraws
        // the live video using the most recent boxes, independently of inference.
        const renderer = rendererRef.current;
        if (renderer) {
          const startedAt = performance.now();
          try {
            renderer.render(trackerRef.current?.getTracks() ?? [], video, {
              showTrail: current.showTrail,
              regionEffect: current.regionEffect,
            });
          } catch (error) {
            active = false;
            setDetectorError(
              error instanceof Error ? error.message : "Failed to render tracking results.",
            );
            stopCamera();
            return;
          }
          const renderedAt = performance.now();
          timings.add({ render: renderedAt - startedAt });
          if (pendingDrawRef.current !== null) {
            timings.add({ total: renderedAt - pendingDrawRef.current });
            pendingDrawRef.current = null;
          }
        }
        report(now);
      }
      callbackId = video.requestVideoFrameCallback(processFrame);
    };

    const handleVisibilityChange = () => {
      resetSource();
    };
    resetSource();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    video.addEventListener("resize", resetSource);
    callbackId = video.requestVideoFrameCallback(processFrame);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      video.removeEventListener("resize", resetSource);
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      trackerRef.current?.reset();
      pendingDrawRef.current = null;
      detector.beginSession();
      rendererRef.current?.reset();
    };
  }, [
    cameraStatus,
    stopCamera,
    detectorStatus,
    inferenceConfiguration,
    timings,
    inferenceLongEdge,
    heatmap,
    videoRef,
    filterCanvasRef,
    overlayCanvasRef,
    stageRef,
  ]);

  return { metrics, detectorStatus, detectorError, resetTimings };
}
