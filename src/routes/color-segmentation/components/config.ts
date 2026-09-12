import type { TrackerSettings } from '../../../shared/tracking/types.ts'
import type { RegionEffect } from '../../../shared/rendering/regionEffect.ts';

export type ColorDetectionSettings = {
  targetColor: string
  hueTolerance: number
  saturationTolerance: number
  valueTolerance: number
}
export type ColorTrackingSettings = ColorDetectionSettings & TrackerSettings & {
  minBlobAreaRatio: number
  showTrail: boolean
  regionEffect: RegionEffect
}

export const DEFAULT_COLOR_SETTINGS: ColorTrackingSettings = {
  targetColor: '#ff0000',
  hueTolerance: 30,
  saturationTolerance: 0.4,
  valueTolerance: 0.35,
  minBlobAreaRatio: 0.001,
  maxMissingDurationMs: 300,
  maxMatchDistanceRatio: 0.12,
  trailDurationMs: 1700,
  showTrail: true,
  regionEffect: 'grayscale',
}
export const ACHROMATIC_SATURATION_LIMIT = 0.1
export const DARK_VALUE_LIMIT = 0.1
export const COLOR_FPS_OPTIONS = [30, 20, 15] as const
export const DEFAULT_COLOR_FPS = 30
export const COLOR_METRICS_INTERVAL_MS = 500
export const COLOR_TIMING_LABELS = {
  capture: 'CAPTURE',
  segmentation: 'COLOR / OPENING',
  components: 'BLOB EXTRACTION',
  tracking: 'TRACKING TIME',
  render: 'DRAW SUBMISSION',
  total: 'PROCESSING',
} as const
