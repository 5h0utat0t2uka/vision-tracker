import { MAX_FRAME_GAP_MS } from './timing.ts'

// Accommodate timestamp rounding without letting the deadline drift.
const DEADLINE_TOLERANCE_MS = 1

export class FrameScheduler {
  private previousTimestampMs: number | null = null
  private nextDeadlineMs = 0
  private targetFps = 0

  reset(): void {
    this.previousTimestampMs = null
    this.nextDeadlineMs = 0
  }

  shouldProcess(timestampMs: number, targetFps: number): boolean {
    if (!Number.isFinite(timestampMs) || !Number.isFinite(targetFps) || targetFps <= 0) {
      throw new RangeError('Invalid frame timestamp or target frame rate.')
    }
    const previous = this.previousTimestampMs
    if (timestampMs === previous) {
      return false
    }
    const intervalMs = 1000 / targetFps
    this.previousTimestampMs = timestampMs

    if (
      previous === null ||
      timestampMs < previous ||
      timestampMs - previous > MAX_FRAME_GAP_MS ||
      targetFps !== this.targetFps
    ) {
      this.targetFps = targetFps
      this.nextDeadlineMs = timestampMs + intervalMs
      return true
    }

    if (timestampMs + DEADLINE_TOLERANCE_MS < this.nextDeadlineMs) {
      return false
    }

    // Skip expired slots in constant time; never process a frame more than once.
    const slots = Math.floor(
      (timestampMs + DEADLINE_TOLERANCE_MS - this.nextDeadlineMs) / intervalMs,
    ) + 1
    this.nextDeadlineMs += slots * intervalMs
    return true
  }
}
