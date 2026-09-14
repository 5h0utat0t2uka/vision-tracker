import assert from "node:assert/strict";
import test from "node:test";
import { getCoverTransform, getDownscaledSize } from "../src/shared/rendering/geometry.ts";

test("downscaling preserves aspect ratio, rounds, and never upscales", () => {
  assert.deepEqual(getDownscaledSize(1920, 1080, 480), { width: 480, height: 270 });
  assert.deepEqual(getDownscaledSize(1080, 1920, 480), { width: 270, height: 480 });
  assert.deepEqual(getDownscaledSize(160, 90, 480), { width: 160, height: 90 });
  assert.deepEqual(getDownscaledSize(1000, 333, 320), { width: 320, height: 107 });
  assert.deepEqual(getDownscaledSize(1000, 1, 320), { width: 320, height: 1 });
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => getDownscaledSize(value, 100, 320), RangeError);
    assert.throws(() => getDownscaledSize(100, value, 320), RangeError);
    assert.throws(() => getDownscaledSize(100, 100, value), RangeError);
  }
});

test("cover geometry centers portrait, landscape and square sources without rounding CSS pixels", () => {
  for (const [sw, sh, width, height] of [
    [1920, 1080, 640, 480],
    [1080, 1920, 640, 480],
    [100, 100, 320.5, 180.5],
  ]) {
    const t = getCoverTransform(sw, sh, width, height);
    assert.ok(t.renderWidth >= width && t.renderHeight >= height);
    assert.equal(t.offsetX * 2 + t.renderWidth, width);
    assert.equal(t.offsetY * 2 + t.renderHeight, height);
    assert.ok(Math.abs(t.renderWidth / sw - t.scale) < 1e-12);
    assert.ok(Math.abs(t.renderHeight / sh - t.scale) < 1e-12);
  }
});
