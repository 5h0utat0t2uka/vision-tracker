import type { Rect, Track } from "../tracking/types.ts";
import { MAX_FRAME_GAP_MS } from "../tracking/timing.ts";

export type HeatmapMode = "occupancy" | "movement";
export const HEATMAP_SCALES = { occupancy: 60, movement: 1 } as const;
const GRID_LONG_EDGE = 128;
// Radius in heatmap cells (not screen pixels). 0 disables blur; larger values soften edges.
export const HEATMAP_BLUR_RADIUS = { occupancy: 6, movement: 2 } as const;
const BLUR_KERNELS = {
  occupancy: createBlurKernel(HEATMAP_BLUR_RADIUS.occupancy),
  movement: createBlurKernel(HEATMAP_BLUR_RADIUS.movement),
};

function createBlurKernel(radius: number): number[] {
  if (!Number.isInteger(radius) || radius < 0 || radius > GRID_LONG_EDGE) {
    throw new RangeError(`Heatmap blur radius must be an integer between 0 and ${GRID_LONG_EDGE}.`);
  }
  // Binomial weights: radius 2 reproduces [1, 4, 6, 4, 1] / 16.
  const kernel = [1];
  for (let i = 1; i <= radius * 2; i++) {
    kernel.push((kernel[i - 1] * (radius * 2 - i + 1)) / i);
  }
  const total = kernel.reduce((sum, weight) => sum + weight, 0);
  return kernel.map((weight) => weight / total);
}
const COLORS = [
  [0, 80, 255],
  [0, 220, 255],
  [0, 230, 80],
  [255, 230, 0],
  [255, 35, 0],
];
type Observation = { time: number; box: Rect; x: number; y: number };

/** Two bounded grids, independent of display FPS and analysis resolution. */
export class Heatmap {
  visible = false;
  mode: HeatmapMode = "occupancy";
  opacity = 0.4;
  width = 0;
  height = 0;
  private occupancy = new Float64Array(0);
  private movement = new Float64Array(0);
  private previous = new Map<number, Observation>();
  private timestamp: number | null = null;
  private revision = 0;
  private paintedRevision = -1;
  private paintedMode: HeatmapMode | null = null;
  private canvas: HTMLCanvasElement | null = null;

  reset(): void {
    this.occupancy.fill(0);
    this.movement.fill(0);
    this.previous.clear();
    this.timestamp = null;
    this.revision++;
  }

  values(mode: HeatmapMode): Float64Array {
    return (mode === "occupancy" ? this.occupancy : this.movement).slice();
  }

  observe(tracks: readonly Track[], time: number, sourceWidth: number, sourceHeight: number): void {
    if (
      ![time, sourceWidth, sourceHeight].every(Number.isFinite) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    )
      return;
    const scale = GRID_LONG_EDGE / Math.max(sourceWidth, sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.occupancy = new Float64Array(width * height);
      this.movement = new Float64Array(width * height);
      this.reset();
    }
    if (time === this.timestamp) return;
    if (this.timestamp !== null && time < this.timestamp) this.reset();
    const current = new Map<number, Observation>();
    const diagonal = Math.hypot(sourceWidth, sourceHeight);
    for (const track of tracks) {
      if (track.state !== "confirmed" || track.lastObservedAtMs !== time) continue;
      const box = track.lastObservedBox;
      const center = track.lastObservedCenter;
      if (
        ![box.x, box.y, box.width, box.height, center.x, center.y].every(Number.isFinite) ||
        box.width <= 0 ||
        box.height <= 0
      )
        continue;
      const observation: Observation = {
        time,
        x: center.x / sourceWidth,
        y: center.y / sourceHeight,
        box: {
          x: box.x / sourceWidth,
          y: box.y / sourceHeight,
          width: box.width / sourceWidth,
          height: box.height / sourceHeight,
        },
      };
      current.set(track.id, observation);
      const previous = this.previous.get(track.id);
      if (!previous || time - previous.time > MAX_FRAME_GAP_MS) continue;
      const seconds = (time - previous.time) / 1000;
      const dx = observation.x - previous.x;
      const dy = observation.y - previous.y;
      const distance = (Math.hypot(dx * sourceWidth, dy * sourceHeight) / diagonal) * 100;
      // Sample along the segment so sparse inference doesn't leave disconnected dots.
      const steps = Math.max(1, Math.min(256, Math.ceil(Math.hypot(dx * width, dy * height) * 2)));
      for (let step = 0; step < steps; step++) {
        const t = (step + 0.5) / steps;
        const boxAt: Rect = {
          x: previous.box.x + (observation.box.x - previous.box.x) * t,
          y: previous.box.y + (observation.box.y - previous.box.y) * t,
          width: previous.box.width + (observation.box.width - previous.box.width) * t,
          height: previous.box.height + (observation.box.height - previous.box.height) * t,
        };
        this.addRectangle(boxAt, seconds / steps);
        const x = Math.floor((previous.x + dx * t) * width);
        const y = Math.floor((previous.y + dy * t) * height);
        if (x >= 0 && x < width && y >= 0 && y < height)
          this.movement[y * width + x] += distance / steps;
      }
    }
    this.previous = current;
    this.timestamp = time;
    this.revision++;
  }

  private addRectangle(box: Rect, seconds: number): void {
    const left = Math.max(0, box.x * this.width);
    const top = Math.max(0, box.y * this.height);
    const right = Math.min(this.width, (box.x + box.width) * this.width);
    const bottom = Math.min(this.height, (box.y + box.height) * this.height);
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        const coverage =
          (Math.min(x + 1, right) - Math.max(x, left)) *
          (Math.min(y + 1, bottom) - Math.max(y, top));
        this.occupancy[y * this.width + x] += seconds * coverage;
      }
    }
  }

  draw(
    context: CanvasRenderingContext2D,
    document: Document,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.visible || this.width === 0) return;
    this.canvas ??= document.createElement("canvas");
    if (this.paintedRevision !== this.revision || this.paintedMode !== this.mode) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      const pixels = this.canvas.getContext("2d");
      if (!pixels) throw new Error("ヒートマップ用Canvasを初期化できませんでした。");
      const data = pixels.createImageData(this.width, this.height);
      // Blur scalar values before coloring; colors themselves are never accumulated.
      const values = this.mode === "occupancy" ? this.occupancy : this.movement;
      const smoothed = new Float64Array(values.length);
      const kernel = BLUR_KERNELS[this.mode];
      const radius = (kernel.length - 1) / 2;
      for (let row = 0; row < this.height; row++) {
        for (let column = 0; column < this.width; column++) {
          let value = 0;
          for (let k = -radius; k <= radius; k++) {
            const sx = Math.max(0, Math.min(this.width - 1, column + k));
            value += values[row * this.width + sx] * kernel[k + radius];
          }
          smoothed[row * this.width + column] = value;
        }
      }
      for (let row = 0; row < this.height; row++) {
        for (let column = 0; column < this.width; column++) {
          let value = 0;
          for (let k = -radius; k <= radius; k++) {
            const sy = Math.max(0, Math.min(this.height - 1, row + k));
            value += smoothed[sy * this.width + column] * kernel[k + radius];
          }
          const intensity = Math.min(1, value / HEATMAP_SCALES[this.mode]);
          const offset = (row * this.width + column) * 4;
          // Blue -> cyan -> green -> yellow -> red, with transparent empty cells.
          const segment = Math.min(3, Math.floor(intensity * 4));
          const fraction = intensity * 4 - segment;
          for (let channel = 0; channel < 3; channel++) {
            data.data[offset + channel] =
              COLORS[segment][channel] * (1 - fraction) + COLORS[segment + 1][channel] * fraction;
          }
          data.data[offset + 3] = Math.round(Math.min(1, intensity * 8) * 255);
        }
      }
      pixels.putImageData(data, 0, 0);
      this.paintedRevision = this.revision;
      this.paintedMode = this.mode;
    }
    context.save();
    context.globalAlpha = this.opacity;
    context.imageSmoothingEnabled = true;
    context.drawImage(this.canvas, x, y, width, height);
    context.restore();
  }
}
