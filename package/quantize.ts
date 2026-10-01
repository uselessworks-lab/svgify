import type { QuantizedImage, Quantizer, RasterImage, ResolvedOptions, RGB } from './types.js';
import { distance, fromLab, toLab } from './color.js';
import type { Lab } from './color.js';
import { parseHex, resolveOptions, toHex } from './options.js';
import type { ColorQuantizationOptions, ColorQuantizationResult, ColorSample } from './types.js';
interface Bin { key: number; weight: number; lab: Lab; rgb: RGB }
function nearest(lab: Lab, centers: Lab[]): number {
  let best = 0, error = Infinity;
  for (let c = 0; c < centers.length; c++) { const d = distance(lab, centers[c]); if (d < error) { best = c; error = d; } }
  return best;
}
export const oklabQuantizer: Quantizer = { quantize };
/** 5-bit RGB histogram → deterministic weighted farthest seeding → weighted Oklab k-means. No dithering. */
function quantize(image: RasterImage, o: Readonly<ResolvedOptions>): QuantizedImage {
  const count = new Uint32Array(32768), sums = new Float64Array(32768*3);
  const keys = new Int32Array(image.width*image.height).fill(-1), matte = parseHex(o.matte);
  // Preserve exact limited-color artwork (even two colors within the same histogram bin).
  const exact = new Map<number, number>();
  let exactOverflow = false;
  for (let p = 0; p < keys.length; p++) {
    const i = p*4, alpha = image.data[i+3];
    if (alpha < o.alphaThreshold) continue;
    const a = alpha/255;
    const r = Math.round(image.data[i]*a+matte[0]*(1-a));
    const g = Math.round(image.data[i+1]*a+matte[1]*(1-a));
    const b = Math.round(image.data[i+2]*a+matte[2]*(1-a));
    const key = (r>>3)*1024+(g>>3)*32+(b>>3); keys[p] = key; count[key]++;
    sums[key*3] += r; sums[key*3+1] += g; sums[key*3+2] += b;
    if (!exactOverflow) {
      const packed = r*65536+g*256+b; exact.set(packed, (exact.get(packed) ?? 0)+1);
      if (exact.size > o.colors) { exactOverflow = true; exact.clear(); }
    }
  }
  const bins: Bin[] = [];
  for (let key = 0; key < count.length; key++) if (count[key]) {
    const rgb: RGB = [Math.round(sums[key*3]/count[key]), Math.round(sums[key*3+1]/count[key]), Math.round(sums[key*3+2]/count[key])];
    bins.push({ key, weight: count[key], rgb, lab: toLab(rgb) });
  }
  const labels = new Int8Array(keys.length).fill(-1);
  if (!bins.length) return { width: image.width, height: image.height, labels, palette: [], quantizationError: 0 };
  if (!exactOverflow && !o.palette) {
    const packedColors = [...exact.keys()].sort((a,b) => a-b);
    const palette: RGB[] = packedColors.map(p => [p>>16, (p>>8)&255, p&255]);
    const lookup = new Map(packedColors.map((p,i) => [p,i]));
    for (let p = 0; p < keys.length; p++) if (keys[p] >= 0) {
      const i = p*4, a = image.data[i+3]/255;
      const packed = Math.round(image.data[i]*a+matte[0]*(1-a))*65536 + Math.round(image.data[i+1]*a+matte[1]*(1-a))*256 + Math.round(image.data[i+2]*a+matte[2]*(1-a));
      labels[p] = lookup.get(packed)!;
    }
    return { width: image.width, height: image.height, labels, palette, quantizationError: 0 };
  }
  const palette = learnPalette(bins, o);
  const centers = palette.map(toLab), lookup = new Int8Array(32768);
  let error = 0, total = 0;
  for (const bin of bins) { const c = nearest(bin.lab, centers); lookup[bin.key] = c; error += distance(bin.lab, centers[c])*bin.weight; total += bin.weight; }
  for (let p = 0; p < labels.length; p++) if (keys[p] >= 0) labels[p] = lookup[keys[p]];
  return { width: image.width, height: image.height, labels, palette, quantizationError: Math.sqrt(error/total)*100 };
}

/** Shared weighted Oklab palette learning for raster bins and vector paint samples. */
function learnPalette(bins: readonly Bin[], o: Readonly<ResolvedOptions>): RGB[] {
  let palette: RGB[];
  if (o.palette) palette = o.palette.map(parseHex);
  else {
    const k = Math.min(o.colors, bins.length);
    let dominant = bins[0]; for (const bin of bins) if (bin.weight > dominant.weight) dominant = bin;
    const centers: Lab[] = [dominant.lab];
    const errors = new Float64Array(bins.length).fill(Infinity);
    while (centers.length < k) {
      let best = 0, score = -1;
      for (let i = 0; i < bins.length; i++) {
        errors[i] = Math.min(errors[i], distance(bins[i].lab, centers[centers.length-1]));
        const candidate = errors[i] * Math.sqrt(bins[i].weight);
        if (candidate > score) { score = candidate; best = i; }
      }
      centers.push(bins[best].lab);
    }
    for (let iteration = 0; iteration < o.iterations; iteration++) {
      const weights = new Float64Array(k), accum = new Float64Array(k*3);
      for (const bin of bins) {
        const c = nearest(bin.lab, centers); weights[c] += bin.weight;
        for (let j = 0; j < 3; j++) accum[c*3+j] += bin.lab[j]*bin.weight;
      }
      let shift = 0;
      for (let c = 0; c < k; c++) if (weights[c]) {
        const lab: Lab = [accum[c*3]/weights[c], accum[c*3+1]/weights[c], accum[c*3+2]/weights[c]];
        shift += distance(centers[c], lab); centers[c] = lab;
      }
      if (shift < 1e-9) break;
    }
    palette = centers.map(fromLab);
  }
  // Remove duplicate gamut-clipped colors, sort for reproducible layer order.
  palette = [...new Map(palette.map(rgb => [rgb.join(','), rgb])).values()].sort((a,b) => toLab(a)[0]-toLab(b)[0]);
  return palette;
}

/** Quantize explicit sRGB swatches without allocating pixels or changing geometry. */
export function quantizeColors(samples: readonly ColorSample[], options: ColorQuantizationOptions = {}): ColorQuantizationResult {
  const o = resolveOptions(options);
  const colors = new Map<string, { rgb: RGB; weight: number }>();
  for (const sample of samples) {
    const rgb = parseHex(sample.color), color = toHex(rgb), weight = sample.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) throw new RangeError('Color weights must be positive and finite.');
    const previous = colors.get(color);
    const sum = (previous?.weight ?? 0) + weight;
    if (!Number.isFinite(sum)) throw new RangeError('Combined color weight is too large.');
    colors.set(color, { rgb, weight: sum });
  }
  if (!colors.size) return { palette: [], mapping: [], quantizationError: 0 };
  // Keep exact vector colors, including colors in the same raster histogram bin.
  const bins: Bin[] = [...colors.values()].sort((a, b) =>
    a.rgb[0] - b.rgb[0] || a.rgb[1] - b.rgb[1] || a.rgb[2] - b.rgb[2])
    .map(({ rgb, weight }, key) => ({ key, rgb, weight, lab: toLab(rgb) }));
  const palette = !o.palette && bins.length <= o.colors ? bins.map(bin => bin.rgb) : learnPalette(bins, o);
  const centers = palette.map(toLab), used = new Set<string>();
  let error = 0, total = 0;
  const mapping = [...colors].map(([from, { rgb, weight }]) => {
    const lab = toLab(rgb), index = nearest(lab, centers), to = toHex(palette[index]);
    used.add(to); error += distance(lab, centers[index]) * weight; total += weight;
    return { from, to };
  });
  return { palette: palette.map(toHex).filter(color => used.has(color)), mapping,
    quantizationError: Math.sqrt(error / total) * 100 };
}
