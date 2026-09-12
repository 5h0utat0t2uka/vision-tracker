import type { Detection } from './types.ts'

export class ConnectedComponents {
  private readonly width: number
  private readonly height: number
  private readonly visited: Uint8Array
  private readonly queue: Int32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    const pixelCount = width * height
    this.visited = new Uint8Array(pixelCount)
    this.queue = new Int32Array(pixelCount)
  }

  extract(mask: Uint8Array, minArea: number): Detection[] {
    this.visited.fill(0)
    const detections: Detection[] = []

    for (let startIndex = 0; startIndex < mask.length; startIndex += 1) {
      if (mask[startIndex] === 0 || this.visited[startIndex] === 1) {
        continue
      }

      let head = 0
      let tail = 0
      let area = 0
      let minX = this.width
      let minY = this.height
      let maxX = 0
      let maxY = 0
      let sumX = 0
      let sumY = 0

      this.queue[tail] = startIndex
      tail += 1
      this.visited[startIndex] = 1

      while (head < tail) {
        const index = this.queue[head]
        head += 1
        const y = Math.floor(index / this.width)
        const x = index - y * this.width

        area += 1
        sumX += x
        sumY += y
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)

        const startY = Math.max(0, y - 1)
        const endY = Math.min(this.height - 1, y + 1)
        const startX = Math.max(0, x - 1)
        const endX = Math.min(this.width - 1, x + 1)

        for (let neighborY = startY; neighborY <= endY; neighborY += 1) {
          for (let neighborX = startX; neighborX <= endX; neighborX += 1) {
            const neighborIndex = neighborY * this.width + neighborX

            if (
              mask[neighborIndex] === 1 &&
              this.visited[neighborIndex] === 0
            ) {
              this.visited[neighborIndex] = 1
              this.queue[tail] = neighborIndex
              tail += 1
            }
          }
        }
      }

      if (area < minArea) {
        continue
      }

      detections.push({
        bbox: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        center: {
          x: sumX / area,
          y: sumY / area,
        },
        area,
      })
    }

    return detections
  }
}
