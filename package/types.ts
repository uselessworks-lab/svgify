/** Unpremultiplied, 8-bit sRGB pixels in RGBA order. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
export type RGB = readonly [number, number, number];
export type Point = readonly [number, number];
export interface ConvertOptions {
  /** Hard upper bound, 1–16. Default 8. */
  colors?: number;
  /** Remove a dominant solid background connected to the border. Default false. */
  removeBackground?: boolean;
  /** Boundary simplification in processing pixels, 0–4. Default 1; 0 preserves pixel edges. */
  curveTolerance?: number;
  /** Optional available filament colors; overrides learned palette, still bounded by colors. */
  palette?: readonly string[];
  /** Longest processing edge, 16–2048. Default 768; images are never upscaled. */
  maxDimension?: number;
  /** K-means refinement passes, 1–30. Default 10. */
  iterations?: number;
  /** Merge connected color regions smaller than this pixel area. Default 8; 0 disables. */
  minRegionPixels?: number;
  /** Optional physical area threshold; combined with minRegionPixels using the larger value. */
  minRegionAreaMm2?: number;
  /** Physical output width, in mm. Default 100. */
  widthMm?: number;
  /** Alpha below this value becomes empty space. Default 128. Range 1–255. */
  alphaThreshold?: number;
  /** Remaining translucent pixels are composited over this color. Default #ffffff. */
  matte?: string;
}
export interface ResolvedOptions {
  removeBackground: boolean;
  colors: number; curveTolerance: number; palette?: readonly string[]; maxDimension: number; iterations: number;
  minRegionPixels: number; minRegionAreaMm2: number; widthMm: number;
  alphaThreshold: number; matte: string;
}
export interface QuantizedImage {
  width: number; height: number;
  /** -1 is transparent; other values index palette. */
  labels: Int8Array;
  palette: RGB[];
  /** Weighted histogram approximation, before region cleanup; Oklab units × 100. */
  quantizationError: number;
}
export type PathSegment = { type: 'L'; to: Point } | { type: 'Q'; control: Point; to: Point };
export interface VectorContour { start: Point; segments: PathSegment[] }
export interface ColorLayer {
  id: string; color: string; pixels: number; areaMm2: number;
  /** Exact pixel contours before curve fitting. Positive outer / negative hole winding in downward Y. */
  rings: Point[][];
  /** Actual SVG geometry. Closed paths with line and quadratic Bézier segments. */
  contours: VectorContour[];
  /** Signed vector area after fitting; areaMm2 remains the raster area for compatibility. */
  vectorAreaMm2: number;
  path: string;
}
export interface ConversionResult {
  svg: string;
  width: number; height: number; widthMm: number; heightMm: number;
  palette: string[]; layers: ColorLayer[];
  /** Cleaned indexed raster, useful for downstream modeling and preview. */
  labels: Int8Array;
  stats: {
    /** Pixels removed before quantization, at processing resolution. */
    removedBackgroundPixels: number;
    inputPixels: number; processedPixels: number; opaquePixels: number;
    colors: number; regions: number; holes: number; vertices: number; pointContacts: number;
    mergedRegions: number; changedPixels: number; remainingSmallRegions: number;
    quantizationError: number;
    pathSegments: number; curveSegments: number; simplifiedBoundaries: number; fallbackBoundaries: number;
  };
  warnings: string[];
}
/** A custom (including WASM) quantizer can be injected after initialization. */
export interface Quantizer {
  quantize(image: RasterImage, options: Readonly<ResolvedOptions>): QuantizedImage;
}
