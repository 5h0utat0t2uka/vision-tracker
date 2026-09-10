import { useRef, useState, type RefObject } from 'react'
import { captureFrame } from './rendering/captureFrame.ts'

type CaptureButtonProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  overlayRef: RefObject<HTMLCanvasElement | null>
}

export function CaptureButton({ videoRef, overlayRef }: CaptureButtonProps) {
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function capture() {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setError(null)
    try {
      const video = videoRef.current
      const overlay = overlayRef.current
      if (!video || !overlay) throw new Error('No camera frame is available to capture.')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const blob = await captureFrame(video, overlay)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = url
        link.download = `vision-tracker-${timestamp}.png`
        document.body.append(link)
        link.click()
      } finally {
        link.remove()
        // Allow the browser to consume the URL before releasing its backing data.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the capture.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return (
    <>
      {error && <p className="capture-error" role="alert">{error}</p>}
      <button
        type="button"
        className="capture-button"
        aria-label="Capture PNG"
        title="Capture PNG"
        disabled={saving}
        aria-busy={saving}
        onClick={() => void capture()}
      >
        <span>Capture</span>
        <svg width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" d="M12 18a6 6 0 1 0 0-12a6 6 0 0 0 0 12m0-16C6.477 2 2 6.477 2 12s4.477 10 10 10s10-4.477 10-10S17.523 2 12 2M3.5 12a8.5 8.5 0 1 1 17 0a8.5 8.5 0 0 1-17 0"></path></svg>
      </button>
    </>
  )
}
