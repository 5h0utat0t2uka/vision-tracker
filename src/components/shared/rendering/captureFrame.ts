// Snapshot synchronously before PNG encoding so the two layers cannot advance
// between draws. CSS filters and the separate region-effect canvas are omitted.
export function captureFrame(video: HTMLVideoElement, overlay: HTMLCanvasElement): Promise<Blob> {
  const { width, height } = overlay.getBoundingClientRect()
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0
    || width <= 0 || height <= 0 || overlay.width <= 0 || overlay.height <= 0) {
    throw new Error('No camera frame is available to capture.')
  }

  const canvas = overlay.ownerDocument.createElement('canvas')
  canvas.width = overlay.width
  canvas.height = overlay.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create the capture canvas.')

  // Match centered object-fit: cover using CSS dimensions, independently of DPR.
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  context.drawImage(video,
    (video.videoWidth - sourceWidth) / 2, (video.videoHeight - sourceHeight) / 2,
    sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  context.drawImage(overlay, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Unable to encode the capture as PNG.'))
    }, 'image/png')
  })
}
