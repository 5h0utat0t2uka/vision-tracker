export type Point = {
  x: number
  y: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type Detection = {
  categoryName?: string
  score?: number
  bbox: Rect
  center: Point
  area: number
}

export type TrackState = 'tentative' | 'confirmed' | 'lost'

export type Track = {
  id: number
  categoryName?: string
  score?: number
  bbox: Rect
  center: Point
  /** Filtered observed velocity in analysis pixels per second. */
  velocity: Point
  lastObservedCenter: Point
  lastObservedBox: Rect
  lastObservedAtMs: number
  /** First processed observation that failed to match this track. */
  missingSinceMs?: number
  hits: number
  state: TrackState
  trail: (Point & { timestampMs: number })[]
}

export type TrackerSettings = {
  /** Async detectors can distinguish a missed detection from a gap between observations. */
  missingTimeBasis?: 'last-detection' | 'first-miss'
  maxMissingDurationMs: number
  maxMatchDistanceRatio: number
  trailDurationMs: number
}
