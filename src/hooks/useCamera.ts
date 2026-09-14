import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CameraSession, IDLE_CAMERA_STATE } from "../camera/CameraSession.ts";

export function useCamera(videoRef: RefObject<HTMLVideoElement | null>) {
  const sessionRef = useRef<CameraSession | null>(null);
  const [state, setState] = useState(IDLE_CAMERA_STATE);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        available.filter((device) => device.kind === "videoinput" && device.deviceId.length > 0),
      );
    } catch {
      // Camera acquisition reports actionable permission/device errors separately.
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const session = new CameraSession(video, setState);
    sessionRef.current = session;
    const handlePageHide = () => session.stop();
    const handleDeviceChange = () => void refreshDevices();
    window.addEventListener("pagehide", handlePageHide);
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    void refreshDevices();
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
      session.dispose();
      sessionRef.current = null;
    };
  }, [refreshDevices, videoRef]);

  const start = useCallback(
    async (deviceId?: string) => {
      await sessionRef.current?.start(deviceId);
      await refreshDevices();
    },
    [refreshDevices],
  );
  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  return { ...state, devices, start, stop };
}
