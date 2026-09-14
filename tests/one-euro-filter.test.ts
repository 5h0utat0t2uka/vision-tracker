import assert from "node:assert/strict";
import test from "node:test";
import { OneEuroFilter } from "../src/shared/tracking/OneEuroFilter.ts";
import { BlobTracker, TRAIL_SMOOTHING } from "../src/shared/tracking/BlobTracker.ts";
import { Heatmap } from "../src/shared/heatmap/Heatmap.ts";
import { timeConstantFrom30FpsRate, timeWeight } from "../src/shared/tracking/timing.ts";
import type { Detection, TrackerSettings } from "../src/shared/tracking/types.ts";

const OPTIONS = { minCutoffHz: 1, beta: 10, derivativeCutoffHz: 1 };
const SETTINGS: TrackerSettings = {
  missingTimeBasis: "first-miss",
  maxMissingDurationMs: 800,
  maxMatchDistanceRatio: 0.2,
  trailDurationMs: 1700,
};

test("One Euro Filter follows the adaptive cutoff equations with irregular timestamps", () => {
  const filter = new OneEuroFilter(OPTIONS);
  assert.equal(filter.filter(0.2, 0), 0.2);
  let previous = 0.2;
  let derivative = 0;
  let previousTime = 0;
  for (const [timestamp, input] of [
    [33, 0.21],
    [100, 0.19],
    [300, 0.35],
    [350, 0.4],
  ]) {
    const dt = (timestamp - previousTime) / 1000;
    const derivativeAlpha = 1 / (1 + 1 / (2 * Math.PI * dt));
    derivative = derivativeAlpha * ((input - previous) / dt) + (1 - derivativeAlpha) * derivative;
    const cutoff = 1 + 10 * Math.abs(derivative);
    const alpha = 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    previous = alpha * input + (1 - alpha) * previous;
    near(filter.filter(input, timestamp), previous);
    previousTime = timestamp;
  }
});

for (const fps of [5, 10, 15, 30, 60]) {
  test(`One Euro Filter suppresses stationary jitter at ${fps} fps`, () => {
    const filter = new OneEuroFilter(OPTIONS);
    filter.filter(0.5, 0);
    let rawError = 0;
    let filteredError = 0;
    for (let sample = 1; sample <= fps * 4; sample += 1) {
      const input = 0.5 + (sample % 2 === 0 ? 0.005 : -0.005);
      const output = filter.filter(input, (sample * 1000) / fps);
      rawError += (input - 0.5) ** 2;
      filteredError += (output - 0.5) ** 2;
    }
    assert.ok(filteredError < rawError * 0.4);
  });

  test(`adaptive cutoff reduces moving-target lag at ${fps} fps`, () => {
    const adaptive = new OneEuroFilter(OPTIONS);
    const fixed = new OneEuroFilter({ ...OPTIONS, beta: 0 });
    adaptive.filter(0, 0);
    fixed.filter(0, 0);
    let adaptiveLag = 0;
    let fixedLag = 0;
    for (let sample = 1; sample <= fps; sample += 1) {
      const input = (sample / fps) * 0.5;
      adaptiveLag += input - adaptive.filter(input, (sample * 1000) / fps);
      fixedLag += input - fixed.filter(input, (sample * 1000) / fps);
    }
    assert.ok(adaptiveLag < fixedLag * 0.6);
  });
}

test("duplicate timestamps do not change state and a clock rewind starts fresh", () => {
  const filter = new OneEuroFilter(OPTIONS);
  const reference = new OneEuroFilter(OPTIONS);
  for (const target of [filter, reference]) {
    target.filter(0.1, 0);
    target.filter(0.2, 100);
  }
  assert.equal(filter.filter(999, 100), reference.filter(0.2, 100));
  assert.equal(filter.filter(0.3, 200), reference.filter(0.3, 200));
  assert.equal(filter.filter(0.8, 0), 0.8);
  const fresh = new OneEuroFilter(OPTIONS);
  fresh.filter(0.8, 0);
  assert.equal(filter.filter(0.9, 100), fresh.filter(0.9, 100));
});

test("invalid options and samples are rejected without poisoning state", () => {
  for (const options of [
    { ...OPTIONS, minCutoffHz: 0 },
    { ...OPTIONS, beta: -1 },
    { ...OPTIONS, derivativeCutoffHz: Number.NaN },
    { ...OPTIONS, beta: Infinity },
  ])
    assert.throws(() => new OneEuroFilter(options), RangeError);
  const filter = new OneEuroFilter(OPTIONS);
  filter.filter(0.5, 0);
  assert.throws(() => filter.filter(Number.NaN, 100), RangeError);
  assert.throws(() => filter.filter(0.6, Infinity), RangeError);
  assert.equal(filter.filter(0.5, 100), 0.5);
});

test("tracker smooths only trails, preserving raw measurements and velocity", () => {
  const tracker = new BlobTracker(320, 240);
  tracker.update([detection(100, 80)], 0, SETTINGS);
  const observed = detection(104, 82);
  const [track] = tracker.update([observed], 100, SETTINGS);
  assert.deepEqual(track.center, observed.center);
  assert.deepEqual(track.bbox, observed.bbox);
  assert.deepEqual(track.lastObservedCenter, observed.center);
  assert.deepEqual(track.lastObservedBox, observed.bbox);
  assert.equal(track.lastObservedAtMs, 100);
  const weight = timeWeight(100, timeConstantFrom30FpsRate(0.4));
  near(track.velocity.x, 40 * weight);
  near(track.velocity.y, 20 * weight);
  assert.ok(track.trail[1].x > 100 && track.trail[1].x < 104);
  assert.ok(track.trail[1].y > 80 && track.trail[1].y < 82);
  const snapshot = structuredClone(track);
  tracker.getTracks();
  tracker.update([detection(110, 90)], 100, SETTINGS);
  assert.deepEqual(track, snapshot);
});

test("filtered trails leave both heatmap measurements identical to raw trails", () => {
  const tracker = new BlobTracker(320, 240);
  const filtered = new Heatmap();
  const raw = new Heatmap();
  for (const [timestamp, x, y] of [
    [0, 100, 80],
    [100, 104, 82],
    [180, 102, 81],
    [380, 110, 90],
  ]) {
    const tracks = tracker.update([detection(x, y)], timestamp, SETTINGS);
    filtered.observe(tracks, timestamp, 320, 240);
    raw.observe(
      tracks.map((track) => ({
        ...track,
        trail: [{ ...track.lastObservedCenter, timestampMs: timestamp }],
      })),
      timestamp,
      320,
      240,
    );
  }
  for (const mode of ["occupancy", "movement"] as const) {
    assert.ok(filtered.values(mode).some((value) => value > 0));
    assert.deepEqual(filtered.values(mode), raw.values(mode));
  }
});

test("trail smoothing is invariant under uniform resolution scaling", () => {
  const small = new BlobTracker(320, 240);
  const large = new BlobTracker(1920, 1440);
  for (const [timestamp, x, y] of [
    [0, 100, 80],
    [100, 104, 82],
    [180, 102, 81],
    [380, 110, 90],
  ]) {
    small.update([detection(x, y)], timestamp, SETTINGS);
    large.update([detection(x * 6, y * 6, 6)], timestamp, SETTINGS);
  }
  const a = small.getTracks()[0].trail;
  const b = large.getTracks()[0].trail;
  assert.equal(a.length, 4);
  for (let index = 0; index < a.length; index += 1) {
    near(a[index].x, b[index].x / 6);
    near(a[index].y, b[index].y / 6);
  }
});

for (const reason of ["lost", "long gap", "expired trail"] as const) {
  test(`reacquisition after ${reason} starts a new trail without a connecting line`, () => {
    const tracker = new BlobTracker(320, 240);
    tracker.update([detection(100, 80)], 0, SETTINGS);
    const [original] = tracker.update([detection(104, 82)], 100, SETTINGS);
    const savedTrail = structuredClone(original.trail);
    if (reason === "lost") {
      tracker.update([], 200, SETTINGS);
      assert.deepEqual(original.trail, savedTrail);
    }
    const timestamp = reason === "long gap" ? 101 + TRAIL_SMOOTHING.resetGapMs : 300;
    const settings = reason === "expired trail" ? { ...SETTINGS, trailDurationMs: 50 } : SETTINGS;
    const observed = detection(110, 86);
    const [track] = tracker.update([observed], timestamp, settings);
    assert.equal(track.id, original.id);
    assert.equal(track.trail.length, 1);
    near(track.trail[0].x, observed.center.x);
    near(track.trail[0].y, observed.center.y);
    assert.equal(track.trail[0].timestampMs, timestamp);
  });
}

test("each track has independent filters and reset does not reuse filter history", () => {
  const tracker = new BlobTracker(320, 240);
  tracker.update([detection(80, 80), detection(240, 160)], 0, SETTINGS);
  const tracks = tracker.update([detection(84, 82), detection(240, 160)], 100, SETTINGS);
  assert.equal(tracks.length, 2);
  near(tracks[1].trail[1].x, 240);
  near(tracks[1].trail[1].y, 160);
  tracker.reset();
  tracker.update([detection(200, 120)], 0, SETTINGS);
  const [track] = tracker.update([detection(200, 120)], 100, SETTINGS);
  assert.equal(track.id, 1);
  near(track.trail[0].x, 200);
  near(track.trail[1].x, 200);
});

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

function detection(x: number, y: number, scale = 1): Detection {
  return {
    center: { x, y },
    bbox: { x: x - 20 * scale, y: y - 20 * scale, width: 40 * scale, height: 40 * scale },
    area: 1600 * scale ** 2,
  };
}
