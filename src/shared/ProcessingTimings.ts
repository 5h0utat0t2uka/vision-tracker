export const TIMING_SAMPLE_LIMIT = 120
export type TimingSummary<Key extends string> = Record<Key, { average: number; p95: number }>

/** Independent bounded windows: inference and drawing may run at different rates. */
export class ProcessingTimings<Key extends string> {
  private readonly windows: { key: Key; values: Float64Array; cursor: number; count: number }[]

  constructor(labels: Record<Key, string>) {
    this.windows = (Object.keys(labels) as Key[]).map(key => ({
      key, values: new Float64Array(TIMING_SAMPLE_LIMIT), cursor: 0, count: 0,
    }))
  }

  reset(): void {
    for (const window of this.windows) {
      window.count = 0
      window.cursor = 0
    }
  }

  add(sample: Partial<Record<Key, number>>): void {
    for (const window of this.windows) {
      const value = sample[window.key]
      if (value === undefined || !Number.isFinite(value) || value < 0) continue
      window.values[window.cursor] = value
      window.cursor = (window.cursor + 1) % TIMING_SAMPLE_LIMIT
      window.count = Math.min(window.count + 1, TIMING_SAMPLE_LIMIT)
    }
  }

  summarize(): TimingSummary<Key> {
    // Sort only at report time, never in a frame's add() call.
    return Object.fromEntries(this.windows.map(({ key, values, count }) => {
      const sorted = values.slice(0, count).sort()
      return [key, {
        average: count ? sorted.reduce((sum, value) => sum + value, 0) / count : 0,
        p95: count ? sorted[Math.ceil(count * 0.95) - 1] : 0,
      }]
    })) as TimingSummary<Key>
  }
}
