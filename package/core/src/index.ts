export type * from './types.js';
export { DEFAULT_OPTIONS, resolveOptions } from './options.js';
export { oklabQuantizer } from './quantize.js';
import type { ConversionResult, ConvertOptions, Quantizer, RasterImage } from './types.js';
import { parseHex, resolveOptions, validateImage } from './options.js';
import { removeBorderBackground } from './background.js';
import { resizeImage } from './raster.js';
import { oklabQuantizer } from './quantize.js';
import { cleanRegions } from './regions.js';
import { signedArea, traceLayers } from './trace.js';
import { vectorizeLayers } from './curves.js';
import { serializeSvg } from './svg.js';
/** Synchronous deterministic conversion; call inside a Worker for large browser images. */
export function convertImage(input: RasterImage, options: ConvertOptions = {}, quantizer: Quantizer = oklabQuantizer): ConversionResult {
  validateImage(input);
  const o = resolveOptions(options), resized = resizeImage(input, o.maxDimension);
  const background = o.removeBackground ? removeBorderBackground(resized, o.alphaThreshold) : { image: resized, removedPixels: 0 };
  const image = background.image;
  const quantized = { ...quantizer.quantize(image, o) };
  if (quantized.width !== image.width || quantized.height !== image.height || !(quantized.labels instanceof Int8Array) || quantized.labels.length !== image.width*image.height || quantized.palette.length > o.colors || !Number.isFinite(quantized.quantizationError) || quantized.quantizationError < 0) throw new Error('Quantizer returned an invalid indexed image.');
  for (const rgb of quantized.palette) if (rgb.length !== 3 || rgb.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Quantizer returned an invalid RGB color.');
  if (new Set(quantized.palette.map(rgb => rgb.join(','))).size !== quantized.palette.length) throw new Error('Quantizer returned duplicate palette colors.');
  const allowed = o.palette?.map(parseHex).map(rgb => rgb.join(','));
  if (allowed && quantized.palette.some(rgb => !allowed.includes(rgb.join(',')))) throw new Error('Quantizer returned a color outside the supplied palette.');
  for (let p = 0; p < quantized.labels.length; p++) {
    const label = quantized.labels[p];
    if (label < -1 || label >= quantized.palette.length || (label < 0) !== (image.data[p*4+3] < o.alphaThreshold)) throw new Error('Quantizer returned invalid labels or changed the transparency mask.');
  }
  // The provider retains ownership of its buffers.
  quantized.labels = quantized.labels.slice();
  const pixelSizeMm = o.widthMm/image.width;
  const minimum = Math.max(o.minRegionPixels, Math.ceil(o.minRegionAreaMm2/pixelSizeMm**2));
  const cleanup = cleanRegions(quantized, minimum);
  const layers = traceLayers(quantized, pixelSizeMm);
  // Compact labels and palette after cleanup removes unused colors.
  const remap = new Map(layers.map((l,i) => [l.color,i]));
  const lut = quantized.palette.map(rgb => remap.get('#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')) ?? -1);
  for (let p=0; p<quantized.labels.length; p++) if (quantized.labels[p]>=0) quantized.labels[p] = lut[quantized.labels[p]];
  let regions = 0, holes = 0, vertices = 0, opaquePixels = 0, pointContacts = 0;
  for (const layer of layers) { opaquePixels += layer.pixels; for (const ring of layer.rings) { vertices += ring.length; if (signedArea(ring)>0) regions++; else holes++; } }
  for (const layer of layers) {
    const seen = new Set<number>(), contacts = new Set<number>();
    for (const ring of layer.rings) for (const [x,y] of ring) {
      const key = y*(image.width+1)+x;
      if (seen.has(key)) contacts.add(key); else seen.add(key);
    }
    pointContacts += contacts.size;
  }
  const vectorStats = vectorizeLayers(layers, quantized, o.curveTolerance, pixelSizeMm);
  const warnings: string[] = [];
  if (o.removeBackground && !background.removedPixels) warnings.push('No dominant solid background was detected at the image border; the image was kept unchanged.');
  if (vectorStats.fallbackBoundaries) warnings.push(`${vectorStats.fallbackBoundaries} boundaries retained pixel detail to protect small features or avoid contour collisions.`);
  if (pointContacts) warnings.push(`${pointContacts} point contacts between same-color contours; inspect zero-width connections before extrusion.`);
  if (!opaquePixels) warnings.push('No visible pixels remain after background removal and alpha thresholding.');
  if (image.width !== input.width || image.height !== input.height) warnings.push(`Resampled from ${input.width}×${input.height} to ${image.width}×${image.height}; small details may be lost.`);
  if (cleanup.remainingSmallRegions) warnings.push(`${cleanup.remainingSmallRegions} small regions remain after conservative cleanup; isolated artwork is retained.`);
  if (vectorStats.pathSegments > 100_000) warnings.push('Complex SVG: consider a smaller processing size or stronger region cleanup.');
  return {
    svg: serializeSvg(layers, image.width, image.height, o.widthMm),
    width: image.width, height: image.height, widthMm: o.widthMm, heightMm: o.widthMm*image.height/image.width,
    palette: layers.map(l=>l.color), layers, labels: quantized.labels,
    stats: { removedBackgroundPixels: background.removedPixels, inputPixels: input.width*input.height, processedPixels: image.width*image.height, opaquePixels, colors: layers.length, regions, holes, vertices, pointContacts, ...cleanup, ...vectorStats, quantizationError: quantized.quantizationError }, warnings,
  };
}
/** Export one material with the same origin, scale and viewBox as the combined SVG. */
export function exportLayer(result: ConversionResult, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= result.layers.length) throw new RangeError('Invalid layer index.');
  return serializeSvg([result.layers[index]], result.width, result.height, result.widthMm);
}
