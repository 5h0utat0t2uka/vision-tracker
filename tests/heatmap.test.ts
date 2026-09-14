import assert from "node:assert/strict";
import test from "node:test";
import { Heatmap } from "../src/shared/heatmap/Heatmap.ts";
import type { Track } from "../src/shared/tracking/types.ts";

function track(
  time: number,
  x = 32,
  id = 1,
  state: Track["state"] = "confirmed",
  scale = 1,
): Track {
  const box = { x: x * scale, y: 32 * scale, width: 16 * scale, height: 16 * scale };
  const center = { x: (x + 8) * scale, y: 40 * scale };
  return {
    id,
    state,
    hits: 2,
    bbox: box,
    center,
    lastObservedBox: box,
    lastObservedCenter: center,
    lastObservedAtMs: time,
    velocity: { x: 0, y: 0 },
    trail: [],
  };
}
const sum = (values: Float64Array) => values.reduce((total, value) => total + value, 0);
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("stationary rectangle occupancy uses seconds, independently of 5/10/15 FPS", () => {
  for (const fps of [5, 10, 15]) {
    const heatmap = new Heatmap();
    for (let i = 0; i <= fps * 2; i++)
      heatmap.observe([track((i * 1000) / fps)], (i * 1000) / fps, 128, 128);
    close(heatmap.values("occupancy")[40 * 128 + 40], 2);
    close(sum(heatmap.values("occupancy")), 16 * 16 * 2);
    assert.equal(sum(heatmap.values("movement")), 0);
  }
});

test("movement conserves traveled distance across FPS and analysis resolutions", () => {
  for (const fps of [5, 10, 15]) {
    for (const scale of [1, 2, 4]) {
      const heatmap = new Heatmap();
      for (let i = 0; i <= fps; i++) {
        const time = (i * 1000) / fps;
        heatmap.observe(
          [track(time, 16 + (64 * i) / fps, 1, "confirmed", scale)],
          time,
          128 * scale,
          128 * scale,
        );
      }
      close(sum(heatmap.values("movement")), (64 / Math.hypot(128, 128)) * 100);
      close(sum(heatmap.values("occupancy")), 16 * 16);
      const movement = heatmap.values("movement");
      for (let x = 25; x < 87; x++) assert.ok(movement[40 * 128 + x] > 0, `path missing at ${x}`);
    }
  }
});

test("overlapping rectangles add target-seconds; edge coverage is clipped", () => {
  const heatmap = new Heatmap();
  for (const time of [0, 1000])
    heatmap.observe([track(time, -8, 1), track(time, -8, 2)], time, 128, 128);
  close(sum(heatmap.values("occupancy")), 8 * 16 * 2);
  assert.equal(heatmap.values("occupancy")[40 * 128], 2);
});

test("duplicate observations, lost tracks, tentative tracks and long gaps never add phantom heat", () => {
  const heatmap = new Heatmap();
  heatmap.observe([track(0)], 0, 128, 128);
  heatmap.observe([track(100)], 100, 128, 128);
  const before = heatmap.values("occupancy");
  heatmap.observe([track(100, 64)], 100, 128, 128);
  heatmap.observe([track(100, 64, 1, "lost")], 200, 128, 128);
  heatmap.observe([track(300, 64)], 300, 128, 128);
  heatmap.observe([track(2000, 80)], 2000, 128, 128);
  heatmap.observe([track(2100, 80, 1, "tentative")], 2100, 128, 128);
  heatmap.observe([track(2200, 80)], 2200, 128, 128);
  assert.deepEqual(heatmap.values("occupancy"), before);
  assert.equal(sum(heatmap.values("movement")), 0);
});

test("hidden mode keeps both measurements; reset and source rotation clear both", () => {
  const heatmap = new Heatmap();
  heatmap.visible = false;
  heatmap.observe([track(0)], 0, 128, 128);
  heatmap.observe([track(1000, 64)], 1000, 128, 128);
  assert.ok(sum(heatmap.values("movement")) > 0);
  const occupancy = heatmap.values("occupancy");
  heatmap.mode = "movement";
  heatmap.visible = true;
  assert.deepEqual(heatmap.values("occupancy"), occupancy);
  heatmap.reset();
  assert.equal(sum(heatmap.values("occupancy")), 0);
  assert.equal(sum(heatmap.values("movement")), 0);
  heatmap.observe([track(2000)], 2000, 128, 128);
  assert.equal(sum(heatmap.values("movement")), 0);
  heatmap.observe([track(2100)], 2100, 128, 128);
  assert.ok(sum(heatmap.values("occupancy")) > 0);
  heatmap.observe([track(2200)], 2200, 64, 128);
  assert.equal(sum(heatmap.values("occupancy")), 0);
  assert.equal(heatmap.width, 64);
  heatmap.observe([track(2300)], 2300, 64, 128);
  heatmap.observe([track(0)], 0, 64, 128);
  assert.equal(sum(heatmap.values("occupancy")), 0);
});

test("drawing reuses the heat texture and cover coordinates without changing measurements", () => {
  const heatmap = new Heatmap();
  heatmap.visible = true;
  heatmap.observe([track(0)], 0, 128, 128);
  heatmap.observe([track(1000)], 1000, 128, 128);
  let uploads = 0;
  let image: ImageData | undefined;
  const offscreen = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (data: ImageData) => {
      image = data;
      uploads++;
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => offscreen };
  const document = { createElement: () => canvas } as unknown as Document;
  const draws: unknown[][] = [];
  const context = {
    save() {},
    restore() {},
    drawImage: (...args: unknown[]) => draws.push(args),
  } as unknown as CanvasRenderingContext2D;
  const before = heatmap.values("occupancy");
  for (let i = 0; i < 30; i++) heatmap.draw(context, document, -320, 0, 1280, 720);
  assert.equal(uploads, 1);
  assert.equal(draws.length, 30);
  assert.deepEqual(draws[0], [canvas, -320, 0, 1280, 720]);
  assert.deepEqual(heatmap.values("occupancy"), before);
  assert.equal(image!.data[3], 0);
  assert.ok(image!.data[(40 * 128 + 40) * 4 + 3] > 0);
  heatmap.visible = false;
  heatmap.draw(context, document, 0, 0, 128, 128);
  assert.equal(draws.length, 30);
  heatmap.visible = true;
  heatmap.mode = "movement";
  heatmap.draw(context, document, 0, 0, 128, 128);
  assert.equal(uploads, 2);
  assert.equal(image!.data[(40 * 128 + 40) * 4 + 3], 0);
});
