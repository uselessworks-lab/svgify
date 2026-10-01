/** Color-only entry: no raster tracing, curve fitting, or image conversion imports. */
export { quantizeColors } from './quantize.js';
export { quantizeSvgColors } from './svg-colors.js';
export type { ColorSample, ColorQuantizationOptions, ColorQuantizationResult,
  SvgColorQuantizationOptions, SvgColorQuantizationResult, RGB } from './types.js';
