import { useRef, useState, type RefObject } from 'react'
import { captureFrame } from '../../rendering/captureFrame.ts'
import styles from './index.module.css'

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
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button
        type="button"
        className={styles.button}
        aria-label="Capture PNG"
        title="Capture PNG"
        disabled={saving}
        aria-busy={saving}
        onClick={() => void capture()}
      >
        <span>Capture</span>
        {/*<svg width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" d="M12 18a6 6 0 1 0 0-12a6 6 0 0 0 0 12m0-16C6.477 2 2 6.477 2 12s4.477 10 10 10s10-4.477 10-10S17.523 2 12 2M3.5 12a8.5 8.5 0 1 1 17 0a8.5 8.5 0 0 1-17 0"></path></svg>*/}
        <svg width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" fillRule="evenodd" d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2zM17 5v2h2V5zm-5 12a5 5 0 1 0 0-10a5 5 0 0 0 0 10m0-2a3 3 0 1 0 0-6a3 3 0 0 0 0 6"></path></svg>
        {/*<svg width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" d="m9.4 10.5l4.77-8.26a9.98 9.98 0 0 0-8.49 2.01l3.66 6.35zM21.54 9c-.92-2.92-3.15-5.26-6-6.34L11.88 9zm.26 1h-7.49l.29.5l4.76 8.25A9.9 9.9 0 0 0 22 12c0-.69-.07-1.35-.2-2M8.54 12l-3.9-6.75A9.96 9.96 0 0 0 2.2 14h7.49zm-6.08 3c.92 2.92 3.15 5.26 6 6.34L12.12 15zm11.27 0l-3.9 6.76a9.98 9.98 0 0 0 8.49-2.01l-3.66-6.35z"></path></svg>*/}
        {/*<svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10s10-4.49 10-10S17.51 2 12 2M8.5 8c.83 0 1.5.67 1.5 1.5S9.33 11 8.5 11S7 10.33 7 9.5S7.67 8 8.5 8M7 16l2.5-3l1.5 1.5l3-3.5l3 5z"></path></svg>*/}

      </button>
    </>
  )
}
