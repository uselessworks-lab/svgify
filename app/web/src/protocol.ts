import type { ConversionResult, ConvertOptions, RasterImage } from '@uselessworks/svgify';
export interface Request { id: number; image: RasterImage; options: ConvertOptions }
export type Response = { id: number; result: ConversionResult; elapsedMs: number } | { id: number; error: string };
