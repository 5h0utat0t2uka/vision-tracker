import {
  FilesetResolver,
  ObjectDetector,
  type Detection as MediaPipeDetection,
} from '@mediapipe/tasks-vision'
import { convertMediaPipeDetections } from './convertDetections.ts'
import type {
  DetectorWorkerRequest,
  DetectorWorkerResponse,
} from './protocol.ts'
import { INFERENCE_CONFIGURATIONS, type DetectionCategory } from './config.ts'

type WorkerScope = {
  onmessage: ((event: MessageEvent<DetectorWorkerRequest>) => void) | null
  postMessage: (message: DetectorWorkerResponse) => void
}

const workerScope = globalThis as unknown as WorkerScope
let detector: ObjectDetector | null = null
let categories: readonly DetectionCategory[] = []
let queue = Promise.resolve()

workerScope.onmessage = (event) => {
  queue = queue.then(() => handleRequest(event.data)).catch((error: unknown) => {
    const request = event.data
    const message = errorMessage(error)
    if (request.type === 'init' || request.type === 'configure') {
      post({ type: 'error', scope: 'configuration', configurationId: request.configurationId, message })
    } else if (request.type === 'frame') {
      post({ type: 'error', scope: 'frame', generation: request.generation, message })
    } else {
      post({ type: 'error', scope: 'dispose', message })
    }
  })
}

async function handleRequest(request: DetectorWorkerRequest): Promise<void> {
  switch (request.type) {
    case 'init': {
      detector?.close()
      detector = null
      categories = [...request.categories]
      const [vision, modelResponse] = await Promise.all([
        FilesetResolver.forVisionTasks(request.wasmRoot, true),
        fetch(request.modelUrl),
      ])
      if (!modelResponse.ok) {
        throw new Error(`Failed to load model (${modelResponse.status}).`)
      }
      const model = new Uint8Array(await modelResponse.arrayBuffer())
      detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetBuffer: model,
          delegate: INFERENCE_CONFIGURATIONS[request.inferenceConfiguration].delegate,
        },
        runningMode: 'VIDEO',
        categoryAllowlist: [...categories],
        scoreThreshold: request.scoreThreshold,
      })
      post({ type: 'ready', configurationId: request.configurationId })
      return
    }
    case 'configure': {
      if (!detector) throw new Error('Object Detector is not initialized.')
      categories = [...request.categories]
      await detector.setOptions({
        categoryAllowlist: [...categories],
        scoreThreshold: request.scoreThreshold,
      })
      post({ type: 'configured', configurationId: request.configurationId })
      return
    }
    case 'frame': {
      const { bitmap } = request
      try {
        if (!detector) throw new Error('Object Detector is not initialized.')
        const width = bitmap.width
        const height = bitmap.height
        const startedAt = performance.now()
        const result = detector.detectForVideo(bitmap, request.timestampMs)
        const inferenceTimeMs = performance.now() - startedAt
        post({
          type: 'result',
          generation: request.generation,
          timestampMs: request.timestampMs,
          width: request.sourceWidth,
          height: request.sourceHeight,
          detections: convertMediaPipeDetections(
            result.detections as MediaPipeDetection[],
            new Set(categories),
            width,
            height,
            request.sourceWidth,
            request.sourceHeight,
          ),
          inferenceTimeMs,
        })
      } finally {
        bitmap.close()
      }
      return
    }
    case 'dispose':
      detector?.close()
      detector = null
      post({ type: 'disposed' })
  }
}

function post(message: DetectorWorkerResponse): void {
  workerScope.postMessage(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
