import { expect, test } from "@playwright/test";
import type {
  DetectorWorkerRequest,
  DetectorWorkerResponse,
} from "../../src/routes/mediapipe-tasks-vision/lib/protocol.ts";

declare global {
  interface Window {
    testStreams: MediaStream[];
  }
}

for (const mode of ["background-subtraction", "color-segmentation", "mediapipe-tasks-vision"]) {
  test(`${mode}: page starts, applies display settings, restarts and releases the camera`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.testStreams = [];
      navigator.mediaDevices.enumerateDevices = async () => [
        {
          deviceId: "camera-1",
          kind: "videoinput",
          label: "Test camera",
          groupId: "test",
          toJSON() {
            return {};
          },
        },
        {
          deviceId: "camera-2",
          kind: "videoinput",
          label: "",
          groupId: "test",
          toJSON() {
            return {};
          },
        },
      ];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d")!;
        const stream = canvas.captureStream(30);
        // CanvasCaptureMediaStreamTrack supplies a synthetic deviceId unrelated to
        // enumerateDevices. Model an actual camera honoring the requested exact ID.
        const requestedId =
          typeof constraints?.video === "object" ? constraints.video.deviceId : undefined;
        const deviceId =
          typeof requestedId === "object" && "exact" in requestedId
            ? requestedId.exact
            : "camera-1";
        if (typeof deviceId !== "string") throw new Error("Expected a single camera device ID.");
        const track = stream.getVideoTracks()[0];
        const getSettings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...getSettings(), deviceId });
        window.testStreams.push(stream);
        function draw(time: number) {
          if (stream.getVideoTracks()[0].readyState === "ended") return;
          context.fillStyle = "#222222";
          context.fillRect(0, 0, 640, 360);
          context.fillStyle = "#ff0000";
          context.fillRect(200 + 100 * Math.sin(time / 500), 100, 100, 100);
          requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
        return stream;
      };
      // Model inference itself is covered separately. Keep this UI/lifecycle
      // smoke test offline, deterministic and independent of GPU availability.
      class TestWorker extends EventTarget {
        emit(data: DetectorWorkerResponse) {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
        }
        postMessage(message: DetectorWorkerRequest) {
          if (message.type === "init" || message.type === "configure") {
            this.emit({
              type: message.type === "init" ? "ready" : "configured",
              configurationId: message.configurationId,
            });
          } else if (message.type === "frame") {
            message.bitmap.close();
            this.emit({
              type: "result",
              generation: message.generation,
              timestampMs: message.timestampMs,
              width: message.sourceWidth,
              height: message.sourceHeight,
              inferenceTimeMs: 1,
              detections: [
                {
                  categoryName: "person",
                  score: 0.9,
                  bbox: { x: 200, y: 100, width: 100, height: 100 },
                  center: { x: 250, y: 150 },
                  area: 10000,
                },
              ],
            });
          } else if (message.type === "dispose") this.emit({ type: "disposed" });
        }
        terminate() {}
      }
      Object.assign(globalThis, { Worker: TestWorker });
    });
    await page.goto(`/${mode}`);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("button", { name: "Abort", exact: true })).toBeVisible();
    const fps = page
      .locator("dt")
      .filter({ hasText: /^(ANALYSIS|INFERENCE)$/ })
      .locator("..")
      .locator("dd");
    await expect.poll(async () => Number.parseFloat(await fps.innerText())).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const cameraSelect = page.getByLabel("Camera", { exact: true });
    await expect(cameraSelect.locator("option")).toHaveText([
      "Default camera",
      "Test camera",
      "Camera 2",
    ]);
    await cameraSelect.selectOption("camera-2");
    await expect.poll(() => page.evaluate(() => window.testStreams.length)).toBe(2);
    await expect
      .poll(() => page.evaluate(() => window.testStreams[0].getVideoTracks()[0].readyState))
      .toBe("ended");
    await expect(cameraSelect).toHaveValue("camera-2");
    await expect.poll(async () => Number.parseFloat(await fps.innerText())).toBeGreaterThan(0);
    const resolution = page.getByLabel(
      mode === "mediapipe-tasks-vision" ? "Inference resolution" : "Analysis resolution",
      { exact: true },
    );
    await resolution.selectOption("480");
    await expect(resolution).toHaveValue("480");
    const rate = page.getByLabel(
      mode === "mediapipe-tasks-vision" ? "Inference FPS" : "Frame rate limit",
      { exact: true },
    );
    await rate.selectOption("15");
    await expect(rate).toHaveValue("15");
    if (mode === "mediapipe-tasks-vision") {
      const model = page.getByLabel("Inference model", { exact: true });
      await model.selectOption("lite2-cpu-int8");
      await expect(resolution.locator("option:checked")).toHaveText("480 px · Recommended");
      await model.selectOption("lite0-cpu-int8");
      await expect(resolution).toHaveValue("320");
      await expect(resolution.locator("option:checked")).toHaveText("320 px · Recommended");
    }
    await page.getByLabel("Trail lines", { exact: true }).uncheck();
    await page.getByLabel("Region effect", { exact: true }).selectOption("grayscale");
    await expect(page.locator(".filter-canvas")).toHaveAttribute("data-region-effect", "grayscale");
    await page.getByRole("button", { name: "設定を閉じる", exact: true }).click();
    await page.getByRole("button", { name: "Abort", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.testStreams.at(-1)!.getVideoTracks()[0].readyState))
      .toBe("ended");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect.poll(async () => Number.parseFloat(await fps.innerText())).toBeGreaterThan(0);
    await page.getByRole("link", { name: "← Back" }).click();
    await expect(page).toHaveURL("/");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.testStreams.every((stream) =>
            stream.getTracks().every((track) => track.readyState === "ended"),
          ),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
}
