import { expect, test, type Page } from "@playwright/test";
import type { HookHarness } from "./hooks.tsx";

declare global {
  interface Window {
    harness: HookHarness;
  }
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.harness.snapshot());
}
async function update(page: Page, options: Record<string, unknown>) {
  await page.evaluate((next) => window.harness.update(next), options);
}
async function frame(page: Page) {
  await page.evaluate(() => window.harness.frame(600));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/hooks.html");
  await page.waitForFunction(() => !!window.harness);
});

for (const mode of ["background", "color"] as const) {
  test(`${mode}: StrictMode, settings, frame delivery and cleanup`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate((mode) => window.harness.mount(mode), mode);
    expect((await snapshot(page))[mode].instances).toBe(2);
    expect((await snapshot(page)).observers).toBe(1);
    expect((await snapshot(page)).pendingFrames).toBe(0);

    await update(page, { cameraStatus: "running" });
    expect((await snapshot(page)).pendingFrames).toBe(1);
    await frame(page);
    const started = await snapshot(page);
    expect(started[mode].processes).toBe(1);
    expect(started.latest).toMatchObject({ metrics: { trackCount: 1, detectionCount: 1 } });

    // New object identity / drawing options / FPS must not reconstruct or reset.
    await update(page, {
      settings: { ...started.settings, showTrail: false, regionEffect: "grayscale" },
      targetFps: 15,
    });
    expect((await snapshot(page))[mode].resets).toBe(started[mode].resets);
    await frame(page);
    expect((await snapshot(page)).settings).toMatchObject({
      showTrail: false,
      regionEffect: "grayscale",
    });

    if (mode === "color") {
      const before = await snapshot(page);
      await update(page, { settings: { ...before.settings, targetColor: "#00ff00" } });
      expect((await snapshot(page)).color.resets).toBeGreaterThan(before.color.resets);
      expect((await snapshot(page)).latest).toMatchObject({ metrics: { trackCount: 0 } });
      await frame(page);
      expect((await snapshot(page)).settings.targetColor).toBe("#00ff00");
    }
    const beforeResolution = await snapshot(page);
    await update(page, { analysisLongEdge: 480, longEdge: 480 });
    expect((await snapshot(page))[mode].resets).toBeGreaterThan(beforeResolution[mode].resets);
    expect((await snapshot(page))[mode].instances).toBe(2);
    expect((await snapshot(page)).pendingFrames).toBe(1);

    await page.evaluate(() => window.harness.visibility(true));
    const hidden = await snapshot(page);
    await frame(page);
    expect((await snapshot(page))[mode].processes).toBe(hidden[mode].processes);
    await page.evaluate(() => window.harness.visibility(false));
    await page.evaluate(() => window.harness.resize());
    await frame(page);
    expect((await snapshot(page))[mode].processes).toBe(hidden[mode].processes + 1);

    await update(page, { cameraStatus: "suspended" });
    expect((await snapshot(page)).pendingFrames).toBe(0);
    await update(page, { cameraStatus: "running" });
    expect((await snapshot(page)).pendingFrames).toBe(1);
    await update(page, { cameraStatus: "idle" });
    expect((await snapshot(page)).pendingFrames).toBe(0);
    await update(page, { cameraStatus: "running" });
    await page.evaluate(() => window.harness.unmount());
    const ended = await snapshot(page);
    expect(ended.pendingFrames).toBe(0);
    expect(ended.observers).toBe(0);
    await page.evaluate(() => window.harness.lateCallbacks());
    await page.evaluate(() => window.harness.visibility(true));
    expect((await snapshot(page))[mode]).toEqual(ended[mode]);
    expect((await snapshot(page)).pendingFrames).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("MediaPipe: model lifetime, debouncing, latest display settings and measurements", async ({
  page,
}) => {
  await page.evaluate(() => window.harness.mount("mediapipe"));
  let state = await snapshot(page);
  expect(state.workers).toBe(2);
  expect(state.activeWorkers).toBe(1);
  expect(state.observers).toBe(1);
  expect(state.latest).toMatchObject({ detectorStatus: "ready" });

  await update(page, { cameraStatus: "running" });
  await frame(page);
  expect((await snapshot(page)).pendingResults).toBe(1);
  await page.evaluate(() => window.harness.release());
  expect((await snapshot(page)).observations).toBe(1);
  await frame(page);
  await page.evaluate(() => window.harness.release());
  await frame(page);
  expect((await snapshot(page)).latest).toMatchObject({
    metrics: { trackCount: 1, detectionCount: 1 },
  });
  state = await snapshot(page);
  await update(page, { showTrail: false, regionEffect: "grayscale", inferenceFps: 5 });
  await frame(page);
  expect((await snapshot(page)).workers).toBe(state.workers);
  expect((await snapshot(page)).drawOptions).toEqual({
    showTrail: false,
    regionEffect: "grayscale",
  });
  // Rendering the latest state does not create observations.
  expect((await snapshot(page)).observations).toBe(state.observations);

  const configurations = (await snapshot(page)).configurations.length;
  await update(page, { scoreThreshold: 0.6 });
  await update(page, { scoreThreshold: 0.7 });
  expect((await snapshot(page)).configurations.length).toBe(configurations);
  await page.evaluate(() => window.harness.settle());
  state = await snapshot(page);
  expect(state.configurations.length).toBe(configurations + 1);
  expect(state.configurations.at(-1)).toMatchObject({ type: "configure", scoreThreshold: 0.7 });
  expect(state.workers).toBe(2);
  expect(state.pendingFrames).toBe(1);
  const observations = state.observations;
  await page.evaluate(() => window.harness.release());
  expect((await snapshot(page)).observations).toBe(observations);

  // A pending debounce must not configure the replacement Worker twice.
  await update(page, { scoreThreshold: 0.8 });
  await update(page, { inferenceConfiguration: "lite2-cpu-int8", inferenceLongEdge: 480 });
  await page.evaluate(() => window.harness.settle());
  state = await snapshot(page);
  expect(state.workers).toBe(3);
  expect(state.activeWorkers).toBe(1);
  expect(state.configurations.at(-1)).toMatchObject({ type: "init", scoreThreshold: 0.8 });
  expect(state.configurations.length).toBe(configurations + 2);
  expect(state.pendingFrames).toBe(1);
  await page.evaluate(() => window.harness.unmount());
  expect((await snapshot(page)).activeWorkers).toBe(0);
  expect((await snapshot(page)).observers).toBe(0);
});

for (const interruption of ["stop", "resolution", "visibility", "resize", "unmount"] as const) {
  test(`MediaPipe: ignores pending results after ${interruption}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate(() => window.harness.mount("mediapipe"));
    await update(page, { cameraStatus: "running" });
    await frame(page);
    expect((await snapshot(page)).pendingResults).toBe(1);
    if (interruption === "stop") await update(page, { cameraStatus: "idle" });
    if (interruption === "resolution") await update(page, { inferenceLongEdge: 480 });
    if (interruption === "visibility") await page.evaluate(() => window.harness.visibility(true));
    if (interruption === "resize") await page.evaluate(() => window.harness.resize());
    if (interruption === "unmount") await page.evaluate(() => window.harness.unmount());
    const before = await snapshot(page);
    await page.evaluate(() => window.harness.release());
    await page.evaluate(() => window.harness.lateCallbacks());
    const after = await snapshot(page);
    expect(after.observations).toBe(before.observations);
    expect(after.renders).toBe(before.renders);
    expect(after.pendingFrames).toBe(before.pendingFrames);
    expect(after.workers).toBe(2);
    if (interruption !== "unmount") {
      await update(page, { cameraStatus: "running" });
      await page.evaluate(() => window.harness.visibility(false));
      await frame(page);
      await page.evaluate(() => window.harness.release());
      expect((await snapshot(page)).observations).toBe(before.observations + 1);
      await page.evaluate(() => window.harness.unmount());
    }
    expect((await snapshot(page)).pendingFrames).toBe(0);
    expect((await snapshot(page)).activeWorkers).toBe(0);
    expect(errors).toEqual([]);
  });
}
