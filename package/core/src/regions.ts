import type { QuantizedImage } from './types.js';
import { distance, toLab } from './color.js';
export function cleanRegions(image: QuantizedImage, minimum: number) {
  const { width: w, height: h, labels, palette } = image;
  if (minimum <= 1) return { mergedRegions: 0, changedPixels: 0, remainingSmallRegions: 0 };
  const component = new Int32Array(labels.length).fill(-1);
  const next = new Int32Array(labels.length).fill(-1), queue = new Int32Array(labels.length);
  const sizes: number[] = [], heads: number[] = [], tails: number[] = [], colors: number[] = [];
  function neighbors(p: number, visit: (q: number) => void) {
    const x = p % w;
    if (x > 0) visit(p-1); if (x+1 < w) visit(p+1);
    if (p >= w) visit(p-w); if (p+w < w*h) visit(p+w);
  }
  for (let p = 0; p < labels.length; p++) if (labels[p] >= 0 && component[p] < 0) {
    const id = sizes.length, color = labels[p];
    let start = 0, end = 1; queue[0] = p; component[p] = id;
    while (start < end) {
      const current = queue[start++];
      neighbors(current, q => { if (component[q] < 0 && labels[q] === color) { component[q] = id; queue[end++] = q; } });
    }
    for (let j = 0; j < end-1; j++) next[queue[j]] = queue[j+1];
    sizes.push(end); heads.push(p); tails.push(queue[end-1]); colors.push(color);
  }
  const parent = Int32Array.from(sizes, (_, i) => i);
  function root(id: number): number {
    let r = id; while (parent[r] !== r) r = parent[r];
    while (id !== r) { const previous = parent[id]; parent[id] = r; id = previous; } return r;
  }
  const order = sizes.map((_,i) => i).sort((a,b) => sizes[a]-sizes[b] || a-b);
  const labs = palette.map(toLab);
  const processed = new Uint8Array(sizes.length);
  let mergedRegions = 0, changedPixels = 0;
  for (const id of order) {
    if (root(id) !== id || sizes[id] >= minimum) continue;
    processed[id] = 1;
    const contact = new Map<number, number>();
    for (let p = heads[id]; p >= 0; p = next[p]) neighbors(p, q => {
      if (component[q] < 0) return;
      const other = root(component[q]);
      if (other !== id) contact.set(other, (contact.get(other) ?? 0)+1);
    });
    let target = -1, score = -Infinity;
    for (const [other, boundary] of contact) {
      // Only append to a larger component or an already-processed root.
      // Repeated pending-component scans then grow geometrically, avoiding quadratic work.
      if (!processed[other] && sizes[other] < sizes[id]) continue;
      // Prefer perceptually similar neighbors with a substantial shared boundary.
      const candidate = boundary / (0.01 + distance(labs[colors[id]], labs[colors[other]]));
      if (candidate > score || (candidate === score && other < target)) { score = candidate; target = other; }
    }
    if (target < 0) continue; // Never fill transparency or delete isolated artwork.
    parent[id] = target; sizes[target] += sizes[id];
    next[tails[target]] = heads[id]; tails[target] = tails[id]; mergedRegions++;
  }
  for (let p = 0; p < labels.length; p++) if (component[p] >= 0) {
    const color = colors[root(component[p])]; if (labels[p] !== color) changedPixels++;
    labels[p] = color;
  }
  let remainingSmallRegions = 0;
  // Recount actual connected regions: a recolor can also join un-unioned same-color neighbors.
  component.fill(-1);
  for (let p = 0; p < labels.length; p++) if (labels[p] >= 0 && component[p] < 0) {
    let start = 0, end = 1; queue[0] = p; component[p] = 0;
    while (start < end) neighbors(queue[start++], q => {
      if (component[q] < 0 && labels[q] === labels[p]) { component[q] = 0; queue[end++] = q; }
    });
    if (end < minimum) remainingSmallRegions++;
  }
  return { mergedRegions, changedPixels, remainingSmallRegions };
}
