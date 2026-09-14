import { expect, test } from "@playwright/test";
import type {
  DetectorWorkerRequest,
  DetectorWorkerResponse,
} from "../../src/routes/mediapipe-tasks-vision/components/protocol.ts";

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
      navigator.mediaDevices.enumerateDevices = async () => [];
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d")!;
        const stream = canvas.captureStream(30);
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
    await page.getByLabel("Trail lines", { exact: true }).uncheck();
    await page.getByLabel("Region effect", { exact: true }).selectOption("grayscale");
    await expect(page.locator(".filter-canvas")).toHaveAttribute("data-region-effect", "grayscale");
    await page.getByRole("button", { name: "設定を閉じる", exact: true }).click();
    await page.getByRole("button", { name: "Abort", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.testStreams[0].getVideoTracks()[0].readyState))
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
