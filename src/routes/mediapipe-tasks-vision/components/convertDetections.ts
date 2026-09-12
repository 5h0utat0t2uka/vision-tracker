import type { Detection } from '../../../shared/tracking/types.ts'
import type { DetectionCategory } from './config.ts'

export type MediaPipeDetectionLike = {
  boundingBox?: {
    originX: number
    originY: number
    width: number
    height: number
  }
  categories: readonly {
    categoryName: string
    score: number
  }[]
}

export function convertMediaPipeDetections(
  source: readonly MediaPipeDetectionLike[],
  allowedCategories: ReadonlySet<DetectionCategory>,
  imageWidth: number,
  imageHeight: number,
  sourceWidth = imageWidth,
  sourceHeight = imageHeight,
): Detection[] {
  if (imageWidth <= 0 || imageHeight <= 0) return []
  const scaleX = sourceWidth / imageWidth
  const scaleY = sourceHeight / imageHeight

  return source.flatMap((sourceDetection) => {
    const box = sourceDetection.boundingBox
    const category = sourceDetection.categories
      .filter((candidate) => allowedCategories.has(candidate.categoryName as DetectionCategory))
      .sort((left, right) => right.score - left.score)[0]
    if (!box || !category || !isFiniteBox(box) || !Number.isFinite(category.score)) return []

    const left = Math.max(0, Math.min(imageWidth, box.originX))
    const top = Math.max(0, Math.min(imageHeight, box.originY))
    const right = Math.max(left, Math.min(imageWidth, box.originX + box.width))
    const bottom = Math.max(top, Math.min(imageHeight, box.originY + box.height))
    const width = (right - left) * scaleX
    const height = (bottom - top) * scaleY
    if (width <= 0 || height <= 0) return []

    return [{
      categoryName: category.categoryName,
      score: category.score,
      bbox: { x: left * scaleX, y: top * scaleY, width, height },
      center: { x: left * scaleX + width / 2, y: top * scaleY + height / 2 },
      area: width * height,
    }]
  })
}

function isFiniteBox(box: NonNullable<MediaPipeDetectionLike['boundingBox']>): boolean {
  return Number.isFinite(box.originX) &&
    Number.isFinite(box.originY) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height)
}
