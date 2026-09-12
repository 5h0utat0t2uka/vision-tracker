/** In-place square opening, with reusable scratch storage and separable passes. */
export class BinaryOpening {
  private readonly width: number
  private readonly height: number
  private readonly radius: number
  private readonly scratch: Uint8Array

  constructor(width: number, height: number, kernelSize = 3) {
    if (!Number.isInteger(kernelSize) || kernelSize < 3 || kernelSize % 2 !== 1) {
      throw new RangeError('Opening kernel size must be an odd integer of at least 3.')
    }
    this.width = width
    this.height = height
    this.radius = (kernelSize - 1) / 2
    this.scratch = new Uint8Array(width * height)
  }

  apply(mask: Uint8Array): void {
    this.applyMorphology(mask, true)
    this.applyMorphology(mask, false)
  }

  // Preserve the existing zero-border behavior used by background subtraction.
  private applyMorphology(mask: Uint8Array, isErosion: boolean): void {
    const { width, height, scratch, radius } = this
    const decisiveValue = isErosion ? 0 : 1
    const initialValue = isErosion ? 1 : 0
    scratch.fill(0)
    for (let y = 0; y < height; y++) {
      for (let x = radius; x < width - radius; x++) {
        const index = y * width + x
        let value = initialValue
        for (let offset = -radius; offset <= radius; offset++) {
          if (mask[index + offset] === decisiveValue) { value = decisiveValue; break }
        }
        scratch[index] = value
      }
    }
    mask.fill(0)
    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        const index = y * width + x
        let value = initialValue
        for (let offset = -radius; offset <= radius; offset++) {
          if (scratch[index + offset * width] === decisiveValue) { value = decisiveValue; break }
        }
        mask[index] = value
      }
    }
  }
}
