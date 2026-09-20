import { distance, toLab } from './color.js';
import type { RasterImage } from './types.js';

/** Remove only a dominant, near-solid color connected to the image border. */
export function removeBorderBackground(image: RasterImage, alphaThreshold: number): { image: RasterImage; removedPixels: number } {
  const { width: w, height: h, data } = image;
  const border: number[] = [];
  for (let x = 0; x < w; x++) { border.push(x); if (h > 1) border.push((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { border.push(y * w); if (w > 1) border.push(y * w + w - 1); }
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const p of border) {
    const i = p * 4;
    if (data[i + 3] < alphaThreshold) continue;
    const key = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++; bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2]; bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return { image, removedPixels: 0 };
  const color = toLab([Math.round(dominant.r / dominant.count), Math.round(dominant.g / dominant.count), Math.round(dominant.b / dominant.count)]);
  const matches = (p: number): boolean => {
    const i = p * 4;
    return data[i + 3] >= alphaThreshold && distance(color, toLab([data[i], data[i + 1], data[i + 2]])) <= 0.05 ** 2;
  };
  // Transparent perimeter counts against support, protecting already cut-out images.
  if (border.filter(matches).length <= border.length / 2) return { image, removedPixels: 0 };
  const visited = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const add = (p: number) => { if (!visited[p]) { visited[p] = 1; if (matches(p)) queue[tail++] = p; } };
  for (const p of border) add(p);
  while (head < tail) {
    const p = queue[head++], x = p % w;
    if (x > 0) add(p - 1); if (x + 1 < w) add(p + 1);
    if (p >= w) add(p - w); if (p + w < w * h) add(p + w);
  }
  const output = new Uint8Array(data);
  for (let i = 0; i < tail; i++) output[queue[i] * 4 + 3] = 0;
  return { image: { width: w, height: h, data: output }, removedPixels: tail };
}
