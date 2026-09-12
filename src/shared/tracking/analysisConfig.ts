// Analysis resolution presets (long edge in pixels). The source aspect ratio is preserved.
export const ANALYSIS_LONG_EDGES = [320, 480] as const

export type AnalysisLongEdge = (typeof ANALYSIS_LONG_EDGES)[number]

// Shared by the UI and the engine, independently of preset ordering.
export const DEFAULT_ANALYSIS_LONG_EDGE: AnalysisLongEdge = 320

// Square opening kernel widths, keyed by the selected resolution preset.
export const OPENING_KERNEL_SIZES = {
  320: 3,
  480: 5,
} as const satisfies Record<AnalysisLongEdge, number>

export function isAnalysisLongEdge(value: number): value is AnalysisLongEdge {
  return ANALYSIS_LONG_EDGES.some((longEdge) => longEdge === value)
}

export function getAnalysisSize(sourceWidth: number, sourceHeight: number, longEdge: AnalysisLongEdge = DEFAULT_ANALYSIS_LONG_EDGE): { width: number; height: number } {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('Invalid video dimensions.')
  }
  if (!isAnalysisLongEdge(longEdge)) throw new RangeError('Invalid analysis resolution.')
  const scale = Math.min(1, longEdge / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}
