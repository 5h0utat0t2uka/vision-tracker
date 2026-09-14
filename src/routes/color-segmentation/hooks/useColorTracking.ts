import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { CameraStatus } from "../../../camera/CameraSession.ts";
import type { Heatmap } from "../../../shared/heatmap/Heatmap.ts";
import { ProcessingTimings } from "../../../shared/ProcessingTimings.ts";
import type { AnalysisLongEdge } from "../../../shared/tracking/analysisConfig.ts";
import { FrameScheduler } from "../../../shared/tracking/FrameScheduler.ts";
import { ColorTrackingEngine, INITIAL_COLOR_RESULT } from "../lib/ColorTrackingEngine.ts";
import {
  COLOR_METRICS_INTERVAL_MS,
  COLOR_TIMING_LABELS,
  type ColorTrackingSettings,
} from "../lib/config.ts";

const INITIAL_METRICS = {
  ...INITIAL_COLOR_RESULT,
  analysisFps: 0,
  missedVideoFrames: 0,
  timings: new ProcessingTimings(COLOR_TIMING_LABELS).summarize(),
};

type ColorTrackingOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  analysisCanvasRef: RefObject<HTMLCanvasElement | null>;
  filterCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  heatmap: Heatmap;
  cameraStatus: CameraStatus;
  stopCamera: () => void;
  settings: ColorTrackingSettings;
  targetFps: number;
  analysisLongEdge: AnalysisLongEdge;
};

export function useColorTracking({
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
}: ColorTrackingOptions) {
  const engineRef = useRef<ColorTrackingEngine | null>(null);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  // Detection changes reset history; display/FPS changes only affect future frames.
  const detectionKey = `${settings.targetColor}:${settings.hueTolerance}:${settings.saturationTolerance}:${settings.valueTolerance}:${settings.minBlobAreaRatio}`;
  const readFrameSettings = useEffectEvent(() => ({ settings, targetFps }));
  const resetTimings = useCallback(() => engineRef.current?.resetTimings(), []);

  useEffect(() => {
    const analysis = analysisCanvasRef.current;
    const filter = filterCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    const stage = stageRef.current;
    if (!analysis || !filter || !overlay || !stage) return;
    let engine: ColorTrackingEngine;
    try {
      engine = new ColorTrackingEngine(analysis, filter, overlay, heatmap);
    } catch (error) {
      setEngineError(
        error instanceof Error ? error.message : "Failed to initialize color tracking.",
      );
      return;
    }
    engineRef.current = engine;
    setEngineReady(true);
    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      engine.resizeOverlay(bounds.width, bounds.height, window.devicePixelRatio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => {
      observer.disconnect();
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
      setEngineError("This browser does not support requestVideoFrameCallback().");
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
    let result = INITIAL_COLOR_RESULT;
    const resetProcessing = () => {
      engine.reset();
      scheduler.reset();
      lastReportAt = performance.now();
      lastPresentedFrames = null;
      processedFrames = 0;
      missedVideoFrames = 0;
      result = INITIAL_COLOR_RESULT;
      setMetrics(INITIAL_METRICS);
    };
    const resizeSource = () => {
      engine.syncVideoSize(video, analysisLongEdge);
      resetProcessing();
    };
    const processFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) return;
      if (document.visibilityState === "visible") {
        if (lastPresentedFrames !== null)
          missedVideoFrames += Math.max(0, metadata.presentedFrames - lastPresentedFrames - 1);
        lastPresentedFrames = metadata.presentedFrames;
        try {
          const current = readFrameSettings();
          if (scheduler.shouldProcess(metadata.presentationTime, current.targetFps)) {
            result = engine.process(video, metadata.presentationTime, current.settings);
            processedFrames++;
          }
        } catch (error) {
          active = false;
          setEngineError(
            error instanceof Error ? error.message : "Failed to analyze color regions.",
          );
          stopCamera();
          return;
        }
        const duration = now - lastReportAt;
        if (duration >= COLOR_METRICS_INTERVAL_MS) {
          setMetrics({
            ...result,
            analysisFps: (processedFrames * 1000) / duration,
            missedVideoFrames,
            timings: engine.getTimingSummary(),
          });
          lastReportAt = now;
          processedFrames = 0;
        }
      }
      callbackId = video.requestVideoFrameCallback(processFrame);
    };
    setEngineError(null);
    resizeSource();
    document.addEventListener("visibilitychange", resetProcessing);
    video.addEventListener("resize", resizeSource);
    callbackId = video.requestVideoFrameCallback(processFrame);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", resetProcessing);
      video.removeEventListener("resize", resizeSource);
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      engine.reset();
    };
  }, [
    cameraStatus,
    stopCamera,
    analysisLongEdge,
    detectionKey,
    heatmap,
    videoRef,
    analysisCanvasRef,
    filterCanvasRef,
    overlayCanvasRef,
    stageRef,
  ]);

  return { metrics, engineReady, engineError, resetTimings };
}
