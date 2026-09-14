import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { CameraStatus } from "../../../camera/CameraSession.ts";
import type { Heatmap } from "../../../shared/heatmap/Heatmap.ts";
import { ProcessingTimings, type TimingSummary } from "../../../shared/ProcessingTimings.ts";
import type { AnalysisLongEdge } from "../../../shared/tracking/analysisConfig.ts";
import { FrameScheduler } from "../../../shared/tracking/FrameScheduler.ts";
import { type FrameResult, TrackingEngine } from "../lib/TrackingEngine.ts";
import type { TrackingSettings } from "../lib/types.ts";
import { BACKGROUND_TIMING_LABELS } from "../lib/config.ts";

type RuntimeMetrics = FrameResult & {
  analysisFps: number;
  timings: TimingSummary<keyof typeof BACKGROUND_TIMING_LABELS>;
  missedVideoFrames: number;
};

const INITIAL_METRICS: RuntimeMetrics = {
  trackCount: 0,
  detectionCount: 0,
  isCalibrating: false,
  foregroundRatio: 0,
  analysisFps: 0,
  timings: new ProcessingTimings(BACKGROUND_TIMING_LABELS).summarize(),
  missedVideoFrames: 0,
};

type BackgroundTrackingOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  analysisCanvasRef: RefObject<HTMLCanvasElement | null>;
  filterCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  heatmap: Heatmap;
  cameraStatus: CameraStatus;
  stopCamera: () => void;
  settings: TrackingSettings;
  targetFps: number;
  analysisLongEdge: AnalysisLongEdge;
};

export function useBackgroundTracking({
  videoRef,
  analysisCanvasRef,
  filterCanvasRef,
  overlayCanvasRef,
  stageRef,
  heatmap,
  cameraStatus,
  stopCamera,
  settings,
  targetFps,
  analysisLongEdge,
}: BackgroundTrackingOptions) {
  const engineRef = useRef<TrackingEngine | null>(null);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [engineError, setEngineError] = useState<string | null>(null);
  // Live settings do not restart the frame loop or discard tracking history.
  const readFrameSettings = useEffectEvent(() => ({ settings, targetFps }));
  const resetTimings = useCallback(() => engineRef.current?.resetTimings(), []);

  useEffect(() => {
    const analysisCanvas = analysisCanvasRef.current;
    const filterCanvas = filterCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const stage = stageRef.current;

    if (!analysisCanvas || !filterCanvas || !overlayCanvas || !stage) {
      return;
    }

    const engine = new TrackingEngine(analysisCanvas, filterCanvas, overlayCanvas, heatmap);
    engineRef.current = engine;

    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      engine.resizeOverlay(bounds.width, bounds.height, window.devicePixelRatio);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();

    return () => {
      resizeObserver.disconnect();
      engine.reset();
      engineRef.current = null;
    };
  }, [heatmap, analysisCanvasRef, filterCanvasRef, overlayCanvasRef, stageRef]);

  useEffect(() => {
    const video = videoRef.current;
    const engine = engineRef.current;

    if (cameraStatus !== "running" || !video || !engine) {
      engine?.reset();
      setMetrics(INITIAL_METRICS);
      return;
    }

    if (typeof video.requestVideoFrameCallback !== "function") {
      setEngineError("このブラウザは映像フレーム解析APIに対応していません。");
      stopCamera();
      return;
    }

    let active = true;
    let callbackId: number | null = null;
    const scheduler = new FrameScheduler();
    let lastReportAt = performance.now();
    let lastPresentedFrames: number | null = null;
    let processedFrames = 0;
    let missedVideoFrames = 0;
    let latestResult: FrameResult = {
      trackCount: 0,
      detectionCount: 0,
      isCalibrating: true,
      foregroundRatio: 0,
    };

    const resetProcessing = () => {
      scheduler.reset();
      engine.reset();
      lastReportAt = performance.now();
      lastPresentedFrames = null;
      processedFrames = 0;
      missedVideoFrames = 0;
      latestResult = { ...INITIAL_METRICS, isCalibrating: true };
      setMetrics({ ...INITIAL_METRICS, isCalibrating: true });
    };
    const handleVideoResize = () => {
      engine.syncVideoSize(video, analysisLongEdge);
      resetProcessing();
    };

    const processFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) {
        return;
      }

      if (document.visibilityState !== "visible") {
        callbackId = video.requestVideoFrameCallback(processFrame);
        return;
      }

      if (lastPresentedFrames !== null) {
        missedVideoFrames += Math.max(0, metadata.presentedFrames - lastPresentedFrames - 1);
      }
      lastPresentedFrames = metadata.presentedFrames;

      // presentationTime is a per-frame timestamp in milliseconds, unlike
      // mediaTime (seconds, potentially zero for live streams).
      try {
        const current = readFrameSettings();
        if (scheduler.shouldProcess(metadata.presentationTime, current.targetFps)) {
          latestResult = engine.process(video, metadata.presentationTime, current.settings);
          processedFrames += 1;
        }
      } catch (error) {
        active = false;
        setEngineError(
          error instanceof Error ? error.message : "Unknown error occurred during tracking.",
        );
        stopCamera();
        return;
      }

      const reportDuration = now - lastReportAt;
      if (reportDuration >= 500) {
        setMetrics({
          ...latestResult,
          analysisFps: (processedFrames * 1000) / reportDuration,
          timings: engine.getTimingSummary(),
          missedVideoFrames,
        });
        lastReportAt = now;
        processedFrames = 0;
      }
      callbackId = video.requestVideoFrameCallback(processFrame);
    };

    setEngineError(null);
    engine.syncVideoSize(video, analysisLongEdge);
    resetProcessing();
    document.addEventListener("visibilitychange", resetProcessing);
    video.addEventListener("resize", handleVideoResize);
    callbackId = video.requestVideoFrameCallback(processFrame);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", resetProcessing);
      video.removeEventListener("resize", handleVideoResize);
      if (callbackId !== null) {
        video.cancelVideoFrameCallback(callbackId);
      }
      engine.reset();
    };
  }, [
    cameraStatus,
    stopCamera,
    analysisLongEdge,
    heatmap,
    videoRef,
    analysisCanvasRef,
    filterCanvasRef,
    overlayCanvasRef,
    stageRef,
  ]);

  return { metrics, engineError, resetTimings };
}
