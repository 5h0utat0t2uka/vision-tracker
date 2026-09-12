import type { TimingSummary as Summary } from '../../../shared/ProcessingTimings.ts'
export const TIMING_LABELS = {
  capture: 'CAPTURE',
  roundTrip: 'WORKER ROUND TRIP',
  inference: 'INFERENCE TIME',
  tracking: 'TRACKING TIME',
  render: 'DRAW SUBMISSION',
  total: 'CAPTURE TO FIRST DRAW',
} as const

export type TimingSummary = Summary<keyof typeof TIMING_LABELS>
