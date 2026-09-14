import type { TrackingSettings } from "./types.ts";

export const DEFAULT_BACKGROUND_SETTINGS: TrackingSettings = {
  motionThreshold: 70,
  backgroundTimeConstantMs: 3300,
  minBlobAreaRatio: 0.02,
  maxMissingDurationMs: 300,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
  showTrail: true,
  regionEffect: "none",
};
export const BACKGROUND_FPS_OPTIONS = [30, 20, 15] as const;
export const DEFAULT_BACKGROUND_FPS = 30;
export const BACKGROUND_TIMING_LABELS = {
  capture: "CAPTURE",
  motion: "BACKGROUND / OPENING",
  components: "BLOB EXTRACTION",
  tracking: "TRACKING TIME",
  render: "DRAW SUBMISSION",
  total: "PROCESSING",
} as const;
