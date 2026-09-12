export const DETECTION_CATEGORIES = [
  { value: 'person', label: '人物' },
  { value: 'car', label: '車' },
  { value: 'bicycle', label: '自転車' },
] as const

export type DetectionCategory = (typeof DETECTION_CATEGORIES)[number]['value']

export const INFERENCE_LONG_EDGES = [320, 480, 640] as const
export type InferenceLongEdge = (typeof INFERENCE_LONG_EDGES)[number]

export const INFERENCE_CONFIGURATIONS = {
  'lite0-cpu-int8': {
    label: 'EfficientDet-Lite0 · CPU · int8',
    delegate: 'CPU',
    modelPath: 'mediapipe/models/efficientdet-lite0-int8-v1.tflite',
    recommendedLongEdge: 320,
  },
  'lite0-gpu-float16': {
    label: 'EfficientDet-Lite0 · GPU · float16',
    delegate: 'GPU',
    modelPath: 'mediapipe/models/efficientdet-lite0-float16-v1.tflite',
    recommendedLongEdge: 320,
  },
  'lite2-cpu-int8': {
    label: 'EfficientDet-Lite2 · CPU · int8',
    delegate: 'CPU',
    modelPath: 'mediapipe/models/efficientdet-lite2-int8-v1.tflite',
    recommendedLongEdge: 480,
  },
  'lite2-gpu-float16': {
    label: 'EfficientDet-Lite2 · GPU · float16',
    delegate: 'GPU',
    modelPath: 'mediapipe/models/efficientdet-lite2-float16-v1.tflite',
    recommendedLongEdge: 480,
  },
} as const
export type InferenceConfiguration = keyof typeof INFERENCE_CONFIGURATIONS
export const DEFAULT_INFERENCE_CONFIGURATION: InferenceConfiguration = 'lite0-cpu-int8'
export const DEFAULT_INFERENCE_LONG_EDGE: InferenceLongEdge =
  INFERENCE_CONFIGURATIONS[DEFAULT_INFERENCE_CONFIGURATION].recommendedLongEdge

export function isInferenceConfiguration(value: string): value is InferenceConfiguration {
  return Object.hasOwn(INFERENCE_CONFIGURATIONS, value)
}

export const DEFAULT_DETECTION_CATEGORIES: readonly DetectionCategory[] = ['person']
export const DEFAULT_SCORE_THRESHOLD = 0.7
export const DEFAULT_INFERENCE_FPS = 10
export const INFERENCE_FPS_OPTIONS = [5, 10, 15] as const
export const METRICS_REPORT_INTERVAL_MS = 500
export const TRACK_MISSING_TOLERANCE_MS = 800
// Preserve camera display quality; limit only the image sent for inference.

export function isInferenceLongEdge(value: number): value is InferenceLongEdge {
  return INFERENCE_LONG_EDGES.some(edge => edge === value)
}

export function getInferenceSize(width: number, height: number, longEdge: InferenceLongEdge = DEFAULT_INFERENCE_LONG_EDGE): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Invalid source dimensions.')
  }
  if (!isInferenceLongEdge(longEdge)) throw new RangeError('Invalid inference resolution.')
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const WASM_PATH = 'mediapipe/wasm'

export function resolveMediaPipeAssetUrls(baseUrl: string, origin: string, inferenceConfiguration: InferenceConfiguration = DEFAULT_INFERENCE_CONFIGURATION): {
  modelUrl: string
  wasmRoot: string
} {
  const base = new URL(baseUrl, origin)
  return {
    modelUrl: new URL(INFERENCE_CONFIGURATIONS[inferenceConfiguration].modelPath, base).href,
    wasmRoot: new URL(WASM_PATH, base).href.replace(/\/$/, ''),
  }
}

export function isDetectionCategory(value: string): value is DetectionCategory {
  return DETECTION_CATEGORIES.some((category) => category.value === value)
}
