import { useRef, useState, type RefObject } from "react";
import { captureFrame } from "../../rendering/captureFrame.ts";
import styles from "./index.module.css";

type CaptureButtonProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export function CaptureButton({ videoRef, overlayRef }: CaptureButtonProps) {
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay) throw new Error("No camera frame is available to capture.");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const blob = await captureFrame(video, overlay);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = `vision-tracker-${timestamp}.png`;
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        // Allow the browser to consume the URL before releasing its backing data.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the capture.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
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
        <svg width={24} height={24} viewBox="0 0 24 24">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2zM17 5v2h2V5zm-5 12a5 5 0 1 0 0-10a5 5 0 0 0 0 10m0-2a3 3 0 1 0 0-6a3 3 0 0 0 0 6"
          ></path>
        </svg>
      </button>
    </>
  );
}
