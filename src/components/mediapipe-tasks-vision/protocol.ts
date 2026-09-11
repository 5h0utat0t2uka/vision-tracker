import type { Detection } from '../shared/tracking/types.ts'
import type { DetectionCategory, InferenceConfiguration } from './config.ts'

export type DetectorWorkerRequest =
  | {
      type: 'init'
      inferenceConfiguration: InferenceConfiguration
      configurationId: number
      modelUrl: string
      wasmRoot: string
      categories: readonly DetectionCategory[]
      scoreThreshold: number
    }
  | {
      type: 'configure'
      configurationId: number
      categories: readonly DetectionCategory[]
      scoreThreshold: number
    }
  | {
      type: 'frame'
      generation: number
      bitmap: ImageBitmap
      sourceWidth: number
      sourceHeight: number
      timestampMs: number
    }
  | { type: 'dispose' }

export type DetectorWorkerResponse =
  | { type: 'ready'; configurationId: number }
  | { type: 'configured'; configurationId: number }
  | {
      type: 'result'
      generation: number
      timestampMs: number
      width: number
      height: number
      detections: Detection[]
      inferenceTimeMs: number
    }
  | { type: 'error'; scope: 'configuration'; configurationId: number; message: string }
  | { type: 'error'; scope: 'frame'; generation: number; message: string }
  | { type: 'error'; scope: 'dispose'; message: string }
  | { type: 'disposed' }
