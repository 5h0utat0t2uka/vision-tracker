export type OneEuroFilterOptions = {
  minCutoffHz: number
  beta: number
  derivativeCutoffHz: number
}

/** Timestamp-driven scalar 1€ filter: https://gery.casiez.net/1euro/ */
export class OneEuroFilter {
  private readonly options: Readonly<OneEuroFilterOptions>
  private timestampMs: number | null = null
  private value = 0
  private derivative = 0

  constructor(options: OneEuroFilterOptions) {
    if (
      !Number.isFinite(options.minCutoffHz) || options.minCutoffHz <= 0 ||
      !Number.isFinite(options.beta) || options.beta < 0 ||
      !Number.isFinite(options.derivativeCutoffHz) || options.derivativeCutoffHz <= 0
    ) {
      throw new RangeError('Invalid One Euro Filter options.')
    }
    this.options = { ...options }
  }

  filter(value: number, timestampMs: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(timestampMs)) {
      throw new RangeError('Invalid One Euro Filter sample.')
    }
    if (this.timestampMs === null || timestampMs < this.timestampMs) {
      this.timestampMs = timestampMs
      this.value = value
      this.derivative = 0
      return value
    }
    if (timestampMs === this.timestampMs) return this.value

    const elapsedSeconds = (timestampMs - this.timestampMs) / 1000
    // Use the previous filtered position, as in the authors' reference algorithm.
    const derivative = (value - this.value) / elapsedSeconds
    this.derivative += smoothingWeight(this.options.derivativeCutoffHz, elapsedSeconds)
      * (derivative - this.derivative)
    const cutoffHz = this.options.minCutoffHz + this.options.beta * Math.abs(this.derivative)
    this.value += smoothingWeight(cutoffHz, elapsedSeconds) * (value - this.value)
    this.timestampMs = timestampMs
    return this.value
  }
}

function smoothingWeight(cutoffHz: number, elapsedSeconds: number): number {
  return 1 / (1 + 1 / (2 * Math.PI * cutoffHz * elapsedSeconds))
}
