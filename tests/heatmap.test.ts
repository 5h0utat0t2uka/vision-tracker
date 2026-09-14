import assert from "node:assert/strict";
import test from "node:test";
import {
  Heatmap,
  HEATMAP_BLUR_RADIUS,
  HEATMAP_SCALES,
  type HeatmapMode,
} from "../src/shared/heatmap/Heatmap.ts";
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

function drawingFixture() {
  let uploads = 0,
    allocations = 0,
    resizes = 0,
    contexts = 0;
  let image: ImageData | undefined;
  let width = 0,
    height = 0;
  const pixels = {
    createImageData(w: number, h: number) {
      allocations++;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(data: ImageData) {
      uploads++;
      image = data;
    },
  };
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      resizes++;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      resizes++;
    },
    getContext() {
      contexts++;
      return pixels;
    },
  };
  const document = { createElement: () => canvas } as unknown as Document;
  const context = {
    save() {},
    restore() {},
    drawImage() {},
  } as unknown as CanvasRenderingContext2D;
  return {
    draw(heatmap: Heatmap) {
      heatmap.draw(context, document, 0, 0, 640, 360);
    },
    get image() {
      return image!;
    },
    get counts() {
      return { uploads, allocations, resizes, contexts };
    },
  };
}

test("heatmap reuses buffers and invalidates only changed measurements", () => {
  const heatmap = new Heatmap();
  const f = drawingFixture();
  heatmap.visible = true;
  heatmap.observe([], 0, 128, 128);
  f.draw(heatmap);
  const image = f.image;
  heatmap.observe([], 100, 128, 128);
  f.draw(heatmap);
  heatmap.observe([track(200)], 200, 128, 128);
  f.draw(heatmap);
  assert.equal(f.counts.uploads, 1);
  heatmap.observe([track(300)], 300, 128, 128);
  f.draw(heatmap);
  assert.equal(f.counts.uploads, 2);
  assert.equal(f.image, image);
  heatmap.mode = "movement";
  f.draw(heatmap);
  heatmap.observe([track(400)], 400, 128, 128);
  f.draw(heatmap);
  assert.equal(f.counts.uploads, 3); // Stationary occupancy changed, movement didn't.
  heatmap.observe([track(500, 48)], 500, 128, 128);
  f.draw(heatmap);
  assert.equal(f.counts.uploads, 4);
  heatmap.opacity = 0.8;
  heatmap.visible = false;
  f.draw(heatmap);
  heatmap.visible = true;
  f.draw(heatmap);
  assert.deepEqual(f.counts, { uploads: 4, allocations: 1, resizes: 2, contexts: 1 });
  heatmap.reset();
  f.draw(heatmap);
  assert.equal(f.image, image);
  for (let i = 3; i < f.image.data.length; i += 4) assert.equal(f.image.data[i], 0);
  heatmap.observe([], 600, 64, 128);
  f.draw(heatmap);
  assert.equal(f.counts.allocations, 2);
  // A rotation has the same cell count but different image dimensions.
  heatmap.observe([], 700, 128, 64);
  f.draw(heatmap);
  assert.deepEqual(f.counts, { uploads: 7, allocations: 3, resizes: 6, contexts: 1 });
  assert.equal(f.image.width, 128);
  assert.equal(f.image.height, 64);
});

test("offscreen rectangles do not invalidate the occupancy texture; fractional edges conserve coverage", () => {
  const heatmap = new Heatmap();
  const f = drawingFixture();
  heatmap.visible = true;
  for (const time of [0, 100, 200]) {
    heatmap.observe([track(time, -32), track(time, 140, 2)], time, 128, 128);
    f.draw(heatmap);
  }
  assert.equal(f.counts.uploads, 1);
  assert.equal(sum(heatmap.values("occupancy")), 0);
  heatmap.reset();
  for (const time of [0, 1000]) heatmap.observe([track(time, -0.5)], time, 128, 128);
  close(sum(heatmap.values("occupancy")), 15.5 * 16);
  heatmap.reset();
  for (const time of [0, 1000]) heatmap.observe([track(time, 127.5)], time, 128, 128);
  close(sum(heatmap.values("occupancy")), 0.5 * 16);
});

// Reference implementation of the original separable blur and palette. Compare bytes,
// not timings, so tests detect visual changes without depending on machine performance.
function referencePixels(heatmap: Heatmap, mode: HeatmapMode) {
  const radius = HEATMAP_BLUR_RADIUS[mode];
  const kernel = [1];
  for (let i = 1; i <= radius * 2; i++) kernel.push((kernel[i - 1] * (radius * 2 - i + 1)) / i);
  const total = kernel.reduce((a, b) => a + b, 0);
  const weights = kernel.map((value) => value / total);
  const { width, height } = heatmap;
  let values = heatmap.values(mode);
  for (const horizontal of [true, false]) {
    const result = new Float64Array(values.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? Math.max(0, Math.min(width - 1, x + k)) : x;
          const sy = horizontal ? y : Math.max(0, Math.min(height - 1, y + k));
          result[y * width + x] += values[sy * width + sx] * weights[k + radius];
        }
      }
    values = result;
  }
  const colors = [
    [0, 80, 255],
    [0, 220, 255],
    [0, 230, 80],
    [255, 230, 0],
    [255, 35, 0],
  ];
  const data = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const intensity = Math.min(1, values[i] / HEATMAP_SCALES[mode]);
    const segment = Math.min(3, Math.floor(intensity * 4));
    const fraction = intensity * 4 - segment;
    for (let c = 0; c < 3; c++)
      data[i * 4 + c] = colors[segment][c] * (1 - fraction) + colors[segment + 1][c] * fraction;
    data[i * 4 + 3] = Math.round(Math.min(1, intensity * 8) * 255);
  }
  return data;
}

test("reused heatmap buffers preserve the original blur, palette and mode-switch pixels", () => {
  const heatmap = new Heatmap();
  const f = drawingFixture();
  heatmap.visible = true;
  for (const [width, height] of [
    [128, 64],
    [64, 128],
  ]) {
    for (let i = 0; i < 6; i++) {
      heatmap.observe([track(i * 200, -7.5 + i * 10)], i * 200, width, height);
      for (const mode of ["occupancy", "movement", "occupancy"] as const) {
        heatmap.mode = mode;
        f.draw(heatmap);
        assert.deepEqual(f.image.data, referencePixels(heatmap, mode));
      }
    }
  }
  heatmap.reset();
  heatmap.mode = "occupancy";
  for (let i = 0; i <= HEATMAP_SCALES.occupancy + 1; i++) {
    heatmap.observe([track(i * 1000)], i * 1000, 128, 128);
  }
  f.draw(heatmap);
  assert.deepEqual(f.image.data, referencePixels(heatmap, "occupancy"));
  assert.deepEqual(
    [...f.image.data.slice((40 * 128 + 40) * 4, (40 * 128 + 40) * 4 + 4)],
    [255, 35, 0, 255],
  );
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
