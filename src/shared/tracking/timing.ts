// Preserve the former 30 fps tuning while expressing adaptation in milliseconds.
export const MAX_FRAME_GAP_MS = 1000

export function timeConstantFrom30FpsRate(rate: number): number {
  return -(1000 / 30) / Math.log1p(-rate)
}

export function timeWeight(elapsedMs: number, timeConstantMs: number): number {
  return -Math.expm1(-elapsedMs / timeConstantMs)
}
