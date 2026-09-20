import type { ConvertOptions, RasterImage, ResolvedOptions, RGB } from './types.js';
export const DEFAULT_OPTIONS: Readonly<ResolvedOptions> = Object.freeze({
  removeBackground: false, colors: 8, curveTolerance: 1, maxDimension: 768, iterations: 10, minRegionPixels: 8,
  minRegionAreaMm2: 0, widthMm: 100, alphaThreshold: 128, matte: '#ffffff',
});
export function parseHex(value: string): RGB {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Colors must use #rrggbb format.');
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}
export const toHex = (rgb: RGB): string => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
export function resolveOptions(input: ConvertOptions = {}): ResolvedOptions {
  const o = { ...DEFAULT_OPTIONS, ...input };
  const integer = (name: keyof ResolvedOptions, min: number, max: number) => {
    const v = o[name];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  };
  integer('colors', 1, 16); integer('maxDimension', 16, 2048); integer('iterations', 1, 30);
  integer('alphaThreshold', 1, 255); integer('minRegionPixels', 0, 4_194_304);
  if (!Number.isFinite(o.widthMm) || o.widthMm < 0.1 || o.widthMm > 10000) throw new RangeError('widthMm must be between 0.1 and 10000.');
  if (!Number.isFinite(o.minRegionAreaMm2) || o.minRegionAreaMm2 < 0 || o.minRegionAreaMm2 > 100_000_000) throw new RangeError('minRegionAreaMm2 must be between 0 and 100000000.');
  if (!Number.isFinite(o.curveTolerance) || o.curveTolerance < 0 || o.curveTolerance > 4) throw new RangeError('curveTolerance must be between 0 and 4.');
  if (typeof o.removeBackground !== 'boolean') throw new TypeError('removeBackground must be a boolean.');
  parseHex(o.matte);
  if (o.palette !== undefined) {
    if (!Array.isArray(o.palette) || o.palette.length < 1 || o.palette.length > o.colors) throw new RangeError('palette must contain 1 to colors entries (maximum 16).');
    o.palette.forEach(parseHex);
    o.palette = [...new Set(o.palette.map(c => c.toLowerCase()))];
  }
  return o;
}
export function validateImage(image: RasterImage): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 40_000_000) throw new RangeError('Image dimensions must be positive integers, at most 40 megapixels.');
  if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new TypeError('Expected exactly width × height × 4 RGBA bytes.');
}
