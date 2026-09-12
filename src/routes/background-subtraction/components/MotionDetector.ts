import {
  timeConstantFrom30FpsRate,
  timeWeight,
} from '../../../shared/tracking/timing.ts'
import { BinaryOpening } from '../../../shared/tracking/BinaryOpening.ts'

type MotionDetectorOptions = {
  threshold: number
  backgroundTimeConstantMs: number
}

export type MotionDetectionResult = {
  mask: Uint8Array
  isCalibrating: boolean
  foregroundRatio: number
}

export const WARMUP_DURATION_MS = 700
const WARMUP_TIME_CONSTANT_MS = timeConstantFrom30FpsRate(0.15)
const FOREGROUND_TIME_CONSTANT_MS = timeConstantFrom30FpsRate(0.001)
const GLOBAL_CHANGE_RATIO = 0.8
const GLOBAL_CHANGE_TIME_CONSTANT_MS = timeConstantFrom30FpsRate(0.2)

export class MotionDetector {
  private readonly opening: BinaryOpening
  private readonly background: Float32Array
  private readonly gray: Uint8Array
  private readonly foregroundState: Uint8Array
  private readonly rawMask: Uint8Array
  private hasBackground = false
  private warmupElapsedMs = 0

  constructor(width: number, height: number, openingKernelSize = 3) {
    this.opening = new BinaryOpening(width, height, openingKernelSize)
    const pixelCount = width * height
    this.background = new Float32Array(pixelCount)
    this.gray = new Uint8Array(pixelCount)
    this.foregroundState = new Uint8Array(pixelCount)
    this.rawMask = new Uint8Array(pixelCount)
  }

  reset(): void {
    this.background.fill(0)
    this.foregroundState.fill(0)
    this.rawMask.fill(0)
    this.hasBackground = false
    this.warmupElapsedMs = 0
  }

  process(
    frame: ImageData,
    elapsedMs: number,
    options: MotionDetectorOptions,
  ): MotionDetectionResult {
    this.toGrayscale(frame.data)

    if (!this.hasBackground) {
      this.background.set(this.gray)
      this.hasBackground = true
      this.rawMask.fill(0)
      return this.result(true, 0)
    }

    if (this.warmupElapsedMs < WARMUP_DURATION_MS) {
      this.updateEntireBackground(timeWeight(elapsedMs, WARMUP_TIME_CONSTANT_MS))
      this.warmupElapsedMs += elapsedMs
      this.foregroundState.fill(0)
      this.rawMask.fill(0)
      return this.result(this.warmupElapsedMs < WARMUP_DURATION_MS, 0)
    }

    const threshold = options.threshold
    const releaseThreshold = threshold * 0.7
    let foregroundPixelCount = 0

    for (let index = 0; index < this.gray.length; index += 1) {
      const difference = Math.abs(this.gray[index] - this.background[index])
      const wasForeground = this.foregroundState[index] === 1
      const isForeground =
        difference >= threshold ||
        (wasForeground && difference >= releaseThreshold)

      this.foregroundState[index] = isForeground ? 1 : 0
      this.rawMask[index] = isForeground ? 1 : 0
      foregroundPixelCount += isForeground ? 1 : 0
    }

    const foregroundRatio = foregroundPixelCount / this.gray.length

    if (foregroundRatio >= GLOBAL_CHANGE_RATIO) {
      this.updateEntireBackground(timeWeight(elapsedMs, GLOBAL_CHANGE_TIME_CONSTANT_MS))
      this.foregroundState.fill(0)
      this.rawMask.fill(0)
      return this.result(true, foregroundRatio)
    }

    const foregroundLearningRate = timeWeight(elapsedMs, FOREGROUND_TIME_CONSTANT_MS)
    const backgroundLearningRate = timeWeight(elapsedMs, options.backgroundTimeConstantMs)
    for (let index = 0; index < this.gray.length; index += 1) {
      const learningRate =
        this.rawMask[index] === 1
          ? foregroundLearningRate
          : backgroundLearningRate

      this.background[index] +=
        learningRate * (this.gray[index] - this.background[index])
    }

    this.opening.apply(this.rawMask)
    return this.result(false, foregroundRatio)
  }

  private toGrayscale(source: Uint8ClampedArray): void {
    for (
      let sourceIndex = 0, targetIndex = 0;
      targetIndex < this.gray.length;
      sourceIndex += 4, targetIndex += 1
    ) {
      this.gray[targetIndex] =
        (77 * source[sourceIndex] +
          150 * source[sourceIndex + 1] +
          29 * source[sourceIndex + 2]) >>
        8
    }
  }

  private updateEntireBackground(learningRate: number): void {
    for (let index = 0; index < this.gray.length; index += 1) {
      this.background[index] +=
        learningRate * (this.gray[index] - this.background[index])
    }
  }

  private result(
    isCalibrating: boolean,
    foregroundRatio: number,
  ): MotionDetectionResult {
    return {
      mask: this.rawMask,
      isCalibrating,
      foregroundRatio,
    }
  }
}
