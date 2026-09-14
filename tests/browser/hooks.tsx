import { StrictMode, act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { useBackgroundTracking } from "../../src/routes/background-subtraction/hooks/useBackgroundTracking.ts";
import { useColorTracking } from "../../src/routes/color-segmentation/hooks/useColorTracking.ts";
import { useMediaPipeTracking } from "../../src/routes/mediapipe-tasks-vision/hooks/useMediaPipeTracking.ts";
import { TrackingEngine } from "../../src/routes/background-subtraction/components/TrackingEngine.ts";
import {
  ColorTrackingEngine,
  INITIAL_COLOR_RESULT,
} from "../../src/routes/color-segmentation/components/ColorTrackingEngine.ts";
import {
  DEFAULT_COLOR_SETTINGS,
  type ColorTrackingSettings,
} from "../../src/routes/color-segmentation/components/config.ts";
import type { TrackingSettings } from "../../src/routes/background-subtraction/components/types.ts";
import { DEFAULT_INFERENCE_CONFIGURATION } from "../../src/routes/mediapipe-tasks-vision/components/config.ts";
import { OverlayRenderer } from "../../src/shared/tracking/OverlayRenderer.ts";
import { Heatmap } from "../../src/shared/heatmap/Heatmap.ts";
import type { CameraStatus } from "../../src/camera/CameraSession.ts";
import type {
  DetectorWorkerRequest,
  DetectorWorkerResponse,
} from "../../src/routes/mediapipe-tasks-vision/components/protocol.ts";

// Exercise real React Effects/StrictMode and ObjectDetectorClient. Only browser
// frame delivery and expensive engine/Worker processing are controlled here.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const stats = {
  background: { instances: 0, resets: 0, processes: 0 },
  color: { instances: 0, resets: 0, processes: 0 },
  observers: 0,
  stops: 0,
  renders: 0,
  observations: 0,
  bitmapsClosed: 0,
  configurations: [] as DetectorWorkerRequest[],
  settings: {} as Record<string, unknown>,
  drawOptions: {} as Record<string, unknown>,
};
for (const [kind, Engine] of [
  ["background", TrackingEngine],
  ["color", ColorTrackingEngine],
] as const) {
  const instances = new WeakSet();
  const resize = Engine.prototype.resizeOverlay;
  Engine.prototype.resizeOverlay = function (...args) {
    if (!instances.has(this)) {
      instances.add(this);
      stats[kind].instances++;
    }
    return resize.apply(this, args);
  };
  const reset = Engine.prototype.reset;
  Engine.prototype.reset = function () {
    stats[kind].resets++;
    reset.call(this);
  };
  Engine.prototype.process = function (
    _video: HTMLVideoElement,
    _time: number,
    settings: TrackingSettings | ColorTrackingSettings,
  ) {
    stats[kind].processes++;
    stats.settings = { ...settings };
    return {
      ...INITIAL_COLOR_RESULT,
      trackCount: 1,
      detectionCount: 1,
      isCalibrating: false,
      foregroundRatio: 0.1,
    };
  };
}
OverlayRenderer.prototype.render = function (_tracks, _video, options) {
  stats.renders++;
  stats.drawOptions = { ...options };
};
const observe = Heatmap.prototype.observe;
Heatmap.prototype.observe = function (...args) {
  stats.observations++;
  return observe.apply(this, args);
};

class TestResizeObserver {
  private observing = false;
  observe() {
    if (!this.observing) stats.observers++;
    this.observing = true;
  }
  disconnect() {
    if (this.observing) stats.observers--;
    this.observing = false;
  }
  unobserve() {
    this.disconnect();
  }
}
Object.assign(globalThis, { ResizeObserver: TestResizeObserver });

const frames = new Map<number, VideoFrameRequestCallback>();
const cancelled: VideoFrameRequestCallback[] = [];
let frameId = 0;
let time = 0;
HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
  frames.set(++frameId, callback);
  return frameId;
};
HTMLVideoElement.prototype.cancelVideoFrameCallback = function (id) {
  const callback = frames.get(id);
  if (callback) cancelled.push(callback);
  frames.delete(id);
};
Object.defineProperties(HTMLVideoElement.prototype, {
  videoWidth: { configurable: true, get: () => 640 },
  videoHeight: { configurable: true, get: () => 360 },
});
Object.assign(globalThis, {
  createImageBitmap: async () => ({
    close() {
      stats.bitmapsClosed++;
    },
  }),
});

const workers: TestWorker[] = [];
class TestWorker extends EventTarget {
  terminated = false;
  pending: Extract<DetectorWorkerRequest, { type: "frame" }>[] = [];
  constructor() {
    super();
    workers.push(this);
  }
  emit(message: DetectorWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
  postMessage(message: DetectorWorkerRequest) {
    if (message.type === "init" || message.type === "configure") {
      stats.configurations.push(message);
      queueMicrotask(() =>
        this.emit({
          type: message.type === "init" ? "ready" : "configured",
          configurationId: message.configurationId,
        }),
      );
    } else if (message.type === "frame") {
      message.bitmap.close();
      this.pending.push(message);
    } else if (message.type === "dispose") {
      queueMicrotask(() => this.emit({ type: "disposed" }));
    }
  }
  release() {
    for (const frame of this.pending.splice(0))
      this.emit({
        type: "result",
        generation: frame.generation,
        timestampMs: frame.timestampMs,
        width: frame.sourceWidth,
        height: frame.sourceHeight,
        inferenceTimeMs: 2,
        detections: [
          {
            categoryName: "person",
            score: 0.9,
            bbox: { x: 100, y: 80, width: 60, height: 100 },
            center: { x: 130, y: 130 },
            area: 6000,
          },
        ],
      });
  }
  terminate() {
    this.terminated = true;
  }
}
Object.assign(globalThis, { Worker: TestWorker });

const videoRef = createRef<HTMLVideoElement>();
const analysisCanvasRef = createRef<HTMLCanvasElement>();
const filterCanvasRef = createRef<HTMLCanvasElement>();
const overlayCanvasRef = createRef<HTMLCanvasElement>();
const stageRef = createRef<HTMLElement>();
const heatmap = new Heatmap();
const stopCamera = () => {
  stats.stops++;
};
const common = {
  videoRef,
  stageRef,
  heatmap,
  stopCamera,
  analysisCanvasRef,
  filterCanvasRef,
  overlayCanvasRef,
};
let options = {
  ...common,
  cameraStatus: "idle" as CameraStatus,
  settings: { ...DEFAULT_COLOR_SETTINGS, motionThreshold: 70, backgroundTimeConstantMs: 3300 },
  targetFps: 30,
  analysisLongEdge: 320 as const,
  categories: ["person"] as const,
  scoreThreshold: 0.5,
  inferenceConfiguration: DEFAULT_INFERENCE_CONFIGURATION,
  inferenceLongEdge: 320 as const,
  inferenceFps: 10,
  showTrail: true,
  regionEffect: "none" as const,
};
let latest: unknown;
function Stage() {
  return (
    <section ref={stageRef}>
      <video ref={videoRef} />
      <canvas ref={analysisCanvasRef} />
      <canvas ref={filterCanvasRef} />
      <canvas ref={overlayCanvasRef} />
    </section>
  );
}
function Background() {
  latest = useBackgroundTracking(options);
  return <Stage />;
}
function Color() {
  latest = useColorTracking(options);
  return <Stage />;
}
function MediaPipe() {
  latest = useMediaPipeTracking(options);
  return <Stage />;
}
const root = createRoot(document.getElementById("root")!);
let Component = Background;

const harness = {
  async mount(mode: "background" | "color" | "mediapipe") {
    Component = { background: Background, color: Color, mediapipe: MediaPipe }[mode];
    await act(async () =>
      root.render(
        <StrictMode>
          <Component />
        </StrictMode>,
      ),
    );
  },
  async update(next: Record<string, unknown>) {
    options = { ...options, ...next };
    await act(async () =>
      root.render(
        <StrictMode>
          <Component />
        </StrictMode>,
      ),
    );
  },
  async frame(delta = 100) {
    time = Math.max(time, performance.now()) + delta;
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks)
        callback(time, {
          presentationTime: time,
          presentedFrames: frameId,
        } as VideoFrameCallbackMetadata);
    });
  },
  async release() {
    await act(async () => {
      for (const worker of workers) worker.release();
    });
  },
  async settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
  },
  async visibility(hidden: boolean) {
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: hidden ? "hidden" : "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  },
  async resize() {
    await act(async () => videoRef.current?.dispatchEvent(new Event("resize")));
  },
  async unmount() {
    await act(async () => root.unmount());
  },
  async lateCallbacks() {
    await act(async () => {
      for (const callback of cancelled) callback(time + 100, {} as VideoFrameCallbackMetadata);
    });
  },
  snapshot() {
    return {
      ...stats,
      latest,
      pendingFrames: frames.size,
      workers: workers.length,
      activeWorkers: workers.filter((w) => !w.terminated).length,
      pendingResults: workers.reduce((n, w) => n + w.pending.length, 0),
    };
  },
};
Object.assign(window, { harness });
export type HookHarness = typeof harness;
