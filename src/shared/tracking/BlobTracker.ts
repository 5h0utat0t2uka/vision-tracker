import type { Detection, Rect, Track, TrackerSettings } from './types.ts'
import { timeConstantFrom30FpsRate, timeWeight } from './timing.ts'

const VELOCITY_TIME_CONSTANT_MS = timeConstantFrom30FpsRate(0.4)
const LOST_VELOCITY_TIME_CONSTANT_MS = timeConstantFrom30FpsRate(0.1)
const SEARCH_EXPANSION_DURATION_MS = 1000 * 4 / 30

type MatchCandidate = {
  trackIndex: number
  detectionIndex: number
  cost: number
}

export class BlobTracker {
  private readonly width: number
  private readonly height: number
  private tracks: Track[] = []
  private nextId = 1
  private previousTimestampMs: number | null = null

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  reset(): void {
    this.tracks = []
    this.nextId = 1
    this.previousTimestampMs = null
  }

  /** Read the latest observation state without advancing time or adding hits. */
  getTracks(): readonly Track[] {
    return this.tracks.filter(track => track.state !== 'tentative')
  }

  update(
    detections: readonly Detection[],
    timestampMs: number,
    settings: TrackerSettings,
  ): readonly Track[] {
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('Invalid tracking timestamp.')
    }
    if (timestampMs === this.previousTimestampMs) {
      return this.getTracks()
    }
    if (this.previousTimestampMs !== null && timestampMs < this.previousTimestampMs) {
      this.reset()
    }
    this.previousTimestampMs = timestampMs
    // A first-miss policy does not count time spent awaiting the next observation.
    // Once a miss is observed, expire before association to avoid reviving old IDs.
    this.tracks = this.tracks.filter(
      (track) => {
        const missingSince = settings.missingTimeBasis === 'first-miss'
          ? track.missingSinceMs
          : track.lastObservedAtMs
        return missingSince === undefined || timestampMs - missingSince <= settings.maxMissingDurationMs
      },
    )
    const diagonal = Math.hypot(this.width, this.height)
    const baseMaxDistance = diagonal * settings.maxMatchDistanceRatio
    const candidates: MatchCandidate[] = []

    for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex += 1) {
      const track = this.tracks[trackIndex]
      this.predictTrack(track, timestampMs)
      const maxDistance =
        baseMaxDistance * (1 + Math.min(
          (timestampMs - track.lastObservedAtMs) / SEARCH_EXPANSION_DURATION_MS,
          1,
        ))
      track.trail = track.trail.filter(
        (point) => timestampMs - point.timestampMs <= settings.trailDurationMs,
      )

      for (
        let detectionIndex = 0;
        detectionIndex < detections.length;
        detectionIndex += 1
      ) {
        const detection = detections[detectionIndex]
        if (track.categoryName !== detection.categoryName) {
          continue
        }
        const distance = Math.hypot(
          detection.center.x - track.center.x,
          detection.center.y - track.center.y,
        )

        if (distance > maxDistance) {
          continue
        }

        const overlap = intersectionOverUnion(track.bbox, detection.bbox)
        const cost = distance / maxDistance + (1 - overlap) * 0.35

        if (cost <= 1.25) {
          candidates.push({ trackIndex, detectionIndex, cost })
        }
      }
    }

    candidates.sort((left, right) => left.cost - right.cost)
    const matchedTrackIndexes = new Set<number>()
    const matchedDetectionIndexes = new Set<number>()

    for (const candidate of candidates) {
      if (
        matchedTrackIndexes.has(candidate.trackIndex) ||
        matchedDetectionIndexes.has(candidate.detectionIndex)
      ) {
        continue
      }

      this.updateMatchedTrack(
        this.tracks[candidate.trackIndex],
        detections[candidate.detectionIndex],
        timestampMs,
      )
      matchedTrackIndexes.add(candidate.trackIndex)
      matchedDetectionIndexes.add(candidate.detectionIndex)
    }

    for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex += 1) {
      if (matchedTrackIndexes.has(trackIndex)) {
        continue
      }

      const track = this.tracks[trackIndex]

      if (track.state === 'tentative') {
        continue
      }

      track.state = 'lost'
      track.missingSinceMs ??= timestampMs
      this.predictTrack(track, timestampMs)
    }

    this.tracks = this.tracks.filter((track) => track.state !== 'tentative')

    for (
      let detectionIndex = 0;
      detectionIndex < detections.length;
      detectionIndex += 1
    ) {
      if (!matchedDetectionIndexes.has(detectionIndex)) {
        this.tracks.push(this.createTrack(detections[detectionIndex], timestampMs))
      }
    }

    return this.getTracks()
  }

  private createTrack(detection: Detection, timestampMs: number): Track {
    const track: Track = {
      id: this.nextId,
      categoryName: detection.categoryName,
      score: detection.score,
      bbox: { ...detection.bbox },
      center: { ...detection.center },
      velocity: { x: 0, y: 0 },
      lastObservedCenter: { ...detection.center },
      lastObservedBox: { ...detection.bbox },
      lastObservedAtMs: timestampMs,
      hits: 1,
      state: 'tentative',
      trail: [{ ...detection.center, timestampMs }],
    }
    this.nextId += 1
    return track
  }

  private updateMatchedTrack(
    track: Track,
    detection: Detection,
    timestampMs: number,
  ): void {
    const elapsedMs = timestampMs - track.lastObservedAtMs
    const elapsedSeconds = elapsedMs / 1000
    const measuredVelocityX = (detection.center.x - track.lastObservedCenter.x) / elapsedSeconds
    const measuredVelocityY = (detection.center.y - track.lastObservedCenter.y) / elapsedSeconds
    const weight = timeWeight(elapsedMs, VELOCITY_TIME_CONSTANT_MS)

    track.velocity.x += weight * (measuredVelocityX - track.velocity.x)
    track.velocity.y += weight * (measuredVelocityY - track.velocity.y)
    track.bbox = { ...detection.bbox }
    track.score = detection.score
    track.center = { ...detection.center }
    track.lastObservedBox = { ...detection.bbox }
    track.lastObservedCenter = { ...detection.center }
    track.lastObservedAtMs = timestampMs
    track.missingSinceMs = undefined
    track.hits += 1
    // Confirmation is evidence-based: require two distinct observations.
    track.state = track.hits >= 2 ? 'confirmed' : 'tentative'
    track.trail.push({ ...detection.center, timestampMs })
  }

  private predictTrack(track: Track, timestampMs: number): void {
    // Integrate decaying velocity from the last observation, not from the
    // previous prediction. The result is independent of skipped analysis frames.
    const elapsedMs = timestampMs - track.lastObservedAtMs
    const travelSeconds = track.state === 'lost'
      ? LOST_VELOCITY_TIME_CONSTANT_MS / 1000 * timeWeight(elapsedMs, LOST_VELOCITY_TIME_CONSTANT_MS)
      : elapsedMs / 1000
    const dx = track.velocity.x * travelSeconds
    const dy = track.velocity.y * travelSeconds
    track.center = {
      x: track.lastObservedCenter.x + dx,
      y: track.lastObservedCenter.y + dy,
    }
    track.bbox = {
      ...track.lastObservedBox,
      x: track.lastObservedBox.x + dx,
      y: track.lastObservedBox.y + dy,
    }
  }
}

function intersectionOverUnion(left: Rect, right: Rect): number {
  const intersectionLeft = Math.max(left.x, right.x)
  const intersectionTop = Math.max(left.y, right.y)
  const intersectionRight = Math.min(
    left.x + left.width,
    right.x + right.width,
  )
  const intersectionBottom = Math.min(
    left.y + left.height,
    right.y + right.height,
  )
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft)
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop)
  const intersectionArea = intersectionWidth * intersectionHeight

  if (intersectionArea === 0) {
    return 0
  }

  const unionArea =
    left.width * left.height +
    right.width * right.height -
    intersectionArea
  return intersectionArea / unionArea
}
