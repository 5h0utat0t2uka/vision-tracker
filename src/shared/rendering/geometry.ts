/** Preserve aspect ratio and never upscale the source. */
export function getDownscaledSize(sourceWidth: number, sourceHeight: number, longEdge: number) {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new RangeError("Invalid source dimensions.");
  }
  if (!Number.isFinite(longEdge) || longEdge <= 0) throw new RangeError("Invalid long edge.");
  const scale = Math.min(1, longEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** Centered object-fit: cover geometry in destination coordinates (independent of DPR). */
export function getCoverTransform(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const renderWidth = sourceWidth * scale;
  const renderHeight = sourceHeight * scale;
  return {
    scale,
    renderWidth,
    renderHeight,
    offsetX: (width - renderWidth) / 2,
    offsetY: (height - renderHeight) / 2,
  };
}
