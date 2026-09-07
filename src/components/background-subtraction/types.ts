import type { TrackerSettings } from '../shared/tracking/types.ts'
import type { RegionEffect } from '../shared/rendering/regionEffect.ts';

export type BackgroundDetectionSettings = {
  motionThreshold: number
  backgroundTimeConstantMs: number
  minBlobAreaRatio: number
}

export type RenderSettings = {
  showTrail: boolean;
  regionEffect: RegionEffect;
};

export type TrackingSettings = TrackerSettings & BackgroundDetectionSettings & RenderSettings
