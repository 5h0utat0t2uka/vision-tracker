import { BinaryOpening } from '../../../shared/tracking/BinaryOpening.ts'
import { ACHROMATIC_SATURATION_LIMIT, DARK_VALUE_LIMIT, type ColorDetectionSettings } from './config.ts'

export type HsvColor = { h: number; s: number; v: number }

/** RGB bytes to H [0,360), S/V [0,1]. Reuse `out` in pixel loops. */
export function rgbToHsv(r: number, g: number, b: number, out: HsvColor = { h: 0, s: 0, v: 0 }): HsvColor {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = (g - b) / delta
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  out.h = h
  out.s = max === 0 ? 0 : delta / max
  out.v = max / 255
  return out
}

export function isHexColor(color: string): boolean {
  return /^#[\da-f]{6}$/i.test(color)
}

export function hexToHsv(color: string): HsvColor {
  if (!isHexColor(color)) throw new RangeError('Choose an opaque sRGB color in #rrggbb format.')
  const rgb = Number.parseInt(color.slice(1), 16)
  return rgbToHsv(rgb >> 16, (rgb >> 8) & 255, rgb & 255)
}

export function getColorMode(color: HsvColor): 'chromatic' | 'neutral' | 'dark' {
  if (color.v <= DARK_VALUE_LIMIT) return 'dark'
  return color.s <= ACHROMATIC_SATURATION_LIMIT ? 'neutral' : 'chromatic'
}

export class ColorDetector {
  private readonly width: number
  private readonly height: number
  private readonly mask: Uint8Array
  private readonly opening: BinaryOpening
  private readonly pixel: HsvColor = { h: 0, s: 0, v: 0 }
  private targetHex = ''
  private target: HsvColor = { h: 0, s: 1, v: 1 }

  constructor(width: number, height: number, kernelSize = 3) {
    this.width = width
    this.height = height
    this.mask = new Uint8Array(width * height)
    this.opening = new BinaryOpening(width, height, kernelSize)
  }

  process(frame: ImageData, settings: ColorDetectionSettings): { mask: Uint8Array; matchedRatio: number } {
    if (frame.width !== this.width || frame.height !== this.height || frame.data.length !== this.mask.length * 4) {
      throw new RangeError('Unexpected color analysis frame dimensions.')
    }
    for (const [value, limit] of [[settings.hueTolerance, 180], [settings.saturationTolerance, 1], [settings.valueTolerance, 1]]) {
      if (!Number.isFinite(value) || value < 0 || value > limit) throw new RangeError('Invalid color tolerance.')
    }
    if (settings.targetColor !== this.targetHex) {
      this.target = hexToHsv(settings.targetColor)
      this.targetHex = settings.targetColor
    }
    const { target, mask, pixel } = this
    const mode = getColorMode(target)
    for (let index = 0, offset = 0; index < mask.length; index++, offset += 4) {
      rgbToHsv(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2], pixel)
      let matches = frame.data[offset + 3] === 255 && Math.abs(pixel.v - target.v) <= settings.valueTolerance
      if (matches && mode !== 'dark') {
        matches = Math.abs(pixel.s - target.s) <= settings.saturationTolerance
        if (matches && mode === 'chromatic') {
          const hueDistance = Math.abs(pixel.h - target.h)
          matches = pixel.s > ACHROMATIC_SATURATION_LIMIT && pixel.v > DARK_VALUE_LIMIT &&
            Math.min(hueDistance, 360 - hueDistance) <= settings.hueTolerance
        }
      }
      mask[index] = matches ? 1 : 0
    }
    this.opening.apply(mask)
    let matchedPixels = 0
    for (const value of mask) matchedPixels += value
    return { mask, matchedRatio: matchedPixels / mask.length }
  }
}
