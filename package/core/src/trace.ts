import type { ColorLayer, Point, QuantizedImage } from './types.js';
import { toHex } from './options.js';
export function signedArea(ring: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i+1)%ring.length]; twice += a[0]*b[1]-b[0]*a[1]; }
  return twice/2;
}
/** Separate point-touching cycles into individually simple contours. */
function splitPinches(ring: Point[], stride: number): Point[][] {
  const stack: Point[] = [], positions = new Map<number, number>(), loops: Point[][] = [];
  for (let i = 0; i <= ring.length; i++) {
    const point = ring[i % ring.length], key = point[1]*stride+point[0];
    const previous = positions.get(key);
    if (previous === undefined) { positions.set(key, stack.length); stack.push(point); continue; }
    const loop = stack.slice(previous);
    if (loop.length >= 4 && signedArea(loop) !== 0) loops.push(loop);
    for (let j = previous+1; j < stack.length; j++) positions.delete(stack[j][1]*stride+stack[j][0]);
    stack.length = previous+1;
  }
  return loops;
}
/** Trace the exact cell union. Only collinear vertices are removed, preserving shared borders. */
export function traceLayers(image: QuantizedImage, pixelSizeMm: number): ColorLayer[] {
  const { width: w, height: h, labels, palette } = image, stride = w+1;
  const edges = new Uint8Array(stride*(h+1));
  const delta = [1, stride, -1, -stride];
  const layers: ColorLayer[] = [];
  let totalVertices = 0;
  // Retain junctions even along a straight material boundary, so both sides segment identically.
  const junctions = new Uint8Array(stride*(h+1));
  const label = (x: number,y: number) => x<0 || y<0 || x>=w || y>=h ? -1 : labels[y*w+x];
  for (let y=0;y<=h;y++) for (let x=0;x<=w;x++) {
    const a=label(x-1,y-1),b=label(x,y-1),c=label(x,y),d=label(x-1,y);
    if (Number(a!==b)+Number(b!==c)+Number(c!==d)+Number(d!==a)>2) junctions[y*stride+x]=1;
  }
  for (let color = 0; color < palette.length; color++) {
    edges.fill(0); let pixels = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y*w+x; if (labels[p] !== color) continue; pixels++;
      const v = y*stride+x;
      if (y === 0 || labels[p-w] !== color) edges[v] |= 1;
      if (x === w-1 || labels[p+1] !== color) edges[v+1] |= 2;
      if (y === h-1 || labels[p+w] !== color) edges[v+stride+1] |= 4;
      if (x === 0 || labels[p-1] !== color) edges[v+stride] |= 8;
    }
    if (!pixels) continue;
    const rings: Point[][] = [];
    for (let start = 0; start < edges.length; start++) while (edges[start]) {
      const firstDirection = Math.clz32(edges[start] & -edges[start]) ^ 31;
      let vertex = start, dir = firstDirection;
      const ring: Point[] = [];
      do {
        edges[vertex] &= ~(1 << dir);
        const previousDirection = dir; vertex += delta[dir];
        // Stop before consuming a different contour that touches this start vertex.
        if (vertex === start) break;
        const candidates = [(dir+1)%4, dir, (dir+3)%4, (dir+2)%4];
        dir = candidates.find(d => (edges[vertex] & (1 << d)) !== 0) ?? -1;
        if (dir < 0) throw new Error('Contour boundary is not closed.');
        if (dir !== previousDirection || junctions[vertex]) ring.push([vertex%stride, Math.floor(vertex/stride)]);
      } while (true);
      if (dir !== firstDirection || junctions[start]) ring.push([start%stride, Math.floor(start/stride)]);
      if (ring.length < 4 || signedArea(ring) === 0) throw new Error('Degenerate contour.');
      totalVertices += ring.length;
      if (totalVertices > 2_000_000) throw new RangeError('Image creates too many contour vertices. Reduce maxDimension or increase minRegionPixels.');
      for (const loop of splitPinches(ring, stride)) rings.push(loop);
    }
    const path = rings.map(ring => `M${ring.map(p => `${p[0]} ${p[1]}`).join('L')}Z`).join('');
    layers.push({ id: `color-${layers.length+1}`, color: toHex(palette[color]), pixels, areaMm2: pixels*pixelSizeMm**2, rings, contours: rings.map(r=>({start:r[0],segments:[...r.slice(1),r[0]].map(to=>({type:'L' as const,to}))})), vectorAreaMm2: pixels*pixelSizeMm**2, path });
  }
  return layers;
}
