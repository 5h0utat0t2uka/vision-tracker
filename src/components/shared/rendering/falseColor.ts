// Brightness is computed from sRGB channels, not temperature or linear-light luminance.
// Change these stops to adjust the palette; brightness must increase from 0 to 255.
export const FALSE_COLOR_STOPS = [
  { brightness: 0, color: [0, 0, 180] },
  { brightness: 80, color: [0, 200, 255] },
  { brightness: 150, color: [0, 200, 0] },
  { brightness: 200, color: [255, 255, 0] },
  { brightness: 255, color: [255, 0, 0] },
  // { brightness: 0, color: [0, 0, 0] },
  // { brightness: 80, color: [0, 0, 255] },
  // { brightness: 150, color: [0, 255, 255] },
  // { brightness: 200, color: [255, 255, 0] },
  // { brightness: 255, color: [255, 255, 255] },
] as const

export const FALSE_COLOR_BRIGHTNESS_WEIGHTS = [0.2126, 0.7152, 0.0722] as const

// One RGBA lookup texture, sampled with linear interpolation by the shader.
// Build once, rather than reading or recoloring camera pixels in JavaScript.
export const FALSE_COLOR_PALETTE = new Uint8Array(256 * 4)
let segment = 0
for (let brightness = 0; brightness < 256; brightness++) {
  while (segment < FALSE_COLOR_STOPS.length - 2 && brightness > FALSE_COLOR_STOPS[segment + 1].brightness) {
    segment += 1
  }
  const start = FALSE_COLOR_STOPS[segment]
  const end = FALSE_COLOR_STOPS[segment + 1]
  const weight = (brightness - start.brightness) / (end.brightness - start.brightness)
  for (let channel = 0; channel < 3; channel++) {
    FALSE_COLOR_PALETTE[brightness * 4 + channel] = Math.round(start.color[channel] + (end.color[channel] - start.color[channel]) * weight)
  }
  FALSE_COLOR_PALETTE[brightness * 4 + 3] = 255
}

// SVG table transfer uses evenly spaced entries in [0, 1]. Reuse the WebGL
// palette so both rendering paths follow the same stops and byte rounding.
export const FALSE_COLOR_FILTER_TABLES = [0, 1, 2].map(channel =>
  Array.from({ length: 256 }, (_, brightness) => FALSE_COLOR_PALETTE[brightness * 4 + channel] / 255).join(' '),
)
export const FALSE_COLOR_FILTER_MATRIX = [
  ...Array.from({ length: 3 }, () => [...FALSE_COLOR_BRIGHTNESS_WEIGHTS, 0, 0]).flat(),
  0, 0, 0, 1, 0,
].join(' ')
