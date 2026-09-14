export type CameraStatus = "idle" | "requesting" | "running" | "suspended" | "error";

export type CameraState = {
  status: CameraStatus;
  error: string | null;
  info: {
    width?: number;
    height?: number;
    frameRate?: number;
    facingMode?: string;
    deviceId?: string;
  } | null;
};

export const IDLE_CAMERA_STATE: CameraState = {
  status: "idle",
  error: null,
  info: null,
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

// Owns a single stream; acquisition/playback races can be tested without a camera.
export class CameraSession {
  private readonly video: HTMLVideoElement;
  private readonly onStateChange: (state: CameraState) => void;
  private readonly getUserMedia: GetUserMedia;
  private stream: MediaStream | null = null;
  private removeListeners: (() => void) | null = null;
  private requestId = 0;
  private disposed = false;

  constructor(
    video: HTMLVideoElement,
    onStateChange: (state: CameraState) => void,
    getUserMedia: GetUserMedia = (constraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではカメラを利用できません。HTTPS接続を確認してください。");
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    },
  ) {
    this.video = video;
    this.onStateChange = onStateChange;
    this.getUserMedia = getUserMedia;
  }

  async start(deviceId?: string): Promise<void> {
    if (this.disposed) return;
    const requestId = ++this.requestId;
    this.releaseStream();
    this.onStateChange({ status: "requesting", error: null, info: null });

    try {
      const stream = await this.getUserMedia({
        video: {
          ...(deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: "environment" } }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (requestId !== this.requestId) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended") {
        throw new Error("カメラ映像を取得できませんでした。もう一度開始してください。");
      }

      let playbackReady = false;
      const handleEnded = () => {
        if (requestId !== this.requestId) return;
        this.requestId += 1;
        this.releaseStream();
        this.onStateChange({
          status: "error",
          error: "カメラ映像が終了しました。接続や権限を確認して、もう一度開始してください。",
          info: null,
        });
      };
      const publishTrackState = () => {
        if (requestId !== this.requestId || !playbackReady) return;
        if (track.readyState === "ended") {
          handleEnded();
          return;
        }
        const settings = track.getSettings();
        this.onStateChange({
          status: track.muted ? "suspended" : "running",
          error: null,
          info: {
            width: this.video.videoWidth || settings.width,
            height: this.video.videoHeight || settings.height,
            frameRate: settings.frameRate,
            facingMode: settings.facingMode,
            ...(settings.deviceId ? { deviceId: settings.deviceId } : {}),
          },
        });
      };
      track.addEventListener("ended", handleEnded);
      track.addEventListener("mute", publishTrackState);
      track.addEventListener("unmute", publishTrackState);
      this.video.addEventListener("resize", publishTrackState);
      this.removeListeners = () => {
        track.removeEventListener("ended", handleEnded);
        track.removeEventListener("mute", publishTrackState);
        track.removeEventListener("unmute", publishTrackState);
        this.video.removeEventListener("resize", publishTrackState);
      };

      this.video.srcObject = stream;
      await this.video.play();
      if (requestId !== this.requestId) return;
      playbackReady = true;
      publishTrackState();
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.requestId += 1;
      this.releaseStream();
      this.onStateChange({
        status: "error",
        error: cameraErrorMessage(error),
        info: null,
      });
    }
  }

  stop(): void {
    if (this.disposed) return;
    this.requestId += 1;
    this.releaseStream();
    this.onStateChange(IDLE_CAMERA_STATE);
  }

  dispose(): void {
    this.disposed = true;
    this.requestId += 1;
    this.releaseStream();
  }

  private releaseStream(): void {
    this.removeListeners?.();
    this.removeListeners = null;
    const stream = this.stream;
    this.stream = null;
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    // A stale session must never clear a replacement session's video source.
    if (this.video.srcObject === stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }
}

function cameraErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return error instanceof Error
      ? error.message
      : "カメラの開始中に予期しないエラーが発生しました。";
  }
  switch (error.name) {
    case "NotAllowedError":
      return "カメラへのアクセスが許可されていません。ブラウザのサイト設定を確認してください。";
    case "NotFoundError":
      return "利用可能なカメラが見つかりません。";
    case "NotReadableError":
      return "カメラを開始できませんでした。他のアプリが使用していないか確認してください。";
    case "OverconstrainedError":
      return "カメラが要求された撮影条件に対応していません。";
    case "AbortError":
      return "カメラの開始が中断されました。もう一度お試しください。";
    default:
      return "カメラを開始できませんでした。ブラウザの権限と接続環境を確認してください。";
  }
}
