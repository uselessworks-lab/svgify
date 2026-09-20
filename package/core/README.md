# @uselessworks/svgify

Dependency-free TypeScript library for print-oriented, limited-color SVG artwork. Runs in browsers and Node.js. ESM with TypeScript declarations. This 0.1.0 package is prepared locally; it has not been published to npm.

## API

```ts
import { convertImage, exportLayer } from '@uselessworks/svgify';

// Canvas ImageData satisfies RasterImage directly.
const result = convertImage(imageData, { colors: 8, widthMm: 100 });
console.log(result.svg, result.palette, result.stats, result.warnings);
if (result.layers.length) console.log(exportLayer(result, 0));
```

`convertImage(image, options?, quantizer?)` is synchronous and deterministic for the built-in quantizer. Use a Web Worker for large browser images. The core never reads files or decodes images. Input data must be `Uint8Array` or `Uint8ClampedArray`, exactly `width × height × 4` bytes, unpremultiplied RGBA in sRGB. Maximum input: 40 million pixels. Input bytes are not modified by the built-in pipeline.

### Browser input

```ts
const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
try {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // For larger images, send pixels to a Worker and call convertImage there.
  const result = convertImage(pixels, { colors: 8 });
} finally {
  bitmap.close();
}
```

### Node input (optional external decoder)

```ts
import sharp from 'sharp';
import { convertImage } from '@uselessworks/svgify';
const { data, info } = await sharp('input.png', { limitInputPixels: 40_000_000 })
  .autoOrient().toColourspace('srgb').ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const result = convertImage({ width: info.width, height: info.height, data });
```

`sharp` is an optional decoder in this example, not a dependency of the library. The separate `@uselessworks/svgify-cli` package includes it.

### Options

| Option | Default | Meaning |
|---|---:|---|
| `removeBackground` | false | Remove a dominant border-connected solid background before quantization |
| `colors` | 8 | Hard maximum, integer 1–16 |
| `curveTolerance` | 1 | Simplification in processing pixels, 0–4; 0 keeps exact pixel edges |
| `palette` | auto | Optional `#rrggbb[]`, 1 to `colors` entries; limits output to these colors |
| `maxDimension` | 768 | Longest processing edge, 16–2048; no upscaling |
| `iterations` | 10 | Weighted k-means passes, 1–30 |
| `minRegionPixels` | 8 | Merge connected regions smaller than this area; 0 disables pixel threshold |
| `minRegionAreaMm2` | 0 | Additional physical area threshold; larger threshold wins |
| `widthMm` | 100 | Physical output width, 0.1–10000mm; height follows processing aspect ratio |
| `alphaThreshold` | 128 | Alpha below this value becomes transparent; 1–255 |
| `matte` | `#ffffff` | Composite retained partial alpha onto this opaque color |

Colors and transparency are treated separately: empty space does not consume a filament color. Dithering is deliberately absent to avoid unprintable dot fields. Isolated small islands remain; cleanup never crosses transparency. Cleanup is conservative and may leave other small regions too.

### Background removal

`removeBackground: true` runs after resizing and before quantization, so removed pixels consume no palette entries. It selects the dominant 5-bit RGB bin on the perimeter, averages its color, and requires more than half of all perimeter pixels (including transparent pixels) to match within Oklab distance 0.05. A four-connected flood from matching border pixels removes only pixels within that fixed tolerance. Enclosed same-color details are retained; same-color artwork connected to the background can be removed. Existing transparent pixels never bridge disconnected areas. If no dominant background is found, the image is unchanged and a warning is returned.

This is a solid-background heuristic, not photographic subject segmentation. Input bytes, dimensions, viewBox and physical placement stay unchanged; only the processed alpha mask changes. `stats.removedBackgroundPixels` reports the number removed at processing resolution (zero when disabled). Turning the option off and reconverting the original restores the original mask. Custom quantizers receive the image **after** this optional step.

### Result

- `svg`: closed, filled paths grouped by color; mm dimensions, pixel-space viewBox; no embedded raster.
- `palette`: only used colors, at most `colors`.
- `layers`: stable IDs, hex colors, raster area (`pixels`, `areaMm2`), exact pre-fit polygon `rings`, actual vector `contours`, `vectorAreaMm2`, and SVG `path`. Each vector contour has `start` and closed `segments`: `{ type: "L", to }` or `{ type: "Q", control, to }`. Adjacent materials reuse the same shared segment in reverse.
- `labels`: compact `Int8Array` palette indices at processing resolution; `-1` means empty space.
- `width`, `height`: processing dimensions; `widthMm`, `heightMm`: physical dimensions.
- `stats`: `removedBackgroundPixels`, raster pixel/color/region/hole/vertex counts, `pointContacts`, cleanup merges/changed pixels/remaining small regions, `quantizationError`, and vector `pathSegments`, `curveSegments`, `simplifiedBoundaries`, `fallbackBoundaries`.
- `warnings`: downsampling, remaining small regions, point contacts, complex output or empty image.

`quantizationError` is the histogram-weighted Oklab RMSE × 100 **before cleanup**, not a full-resolution visual quality score. Custom providers supply their own metric following this contract. Raster rings omit the duplicated closing point; closure is implicit. Vector contours include the final segment back to `start`. Use `contours` or `path` for downstream modeling of the exported geometry, not the pre-fit `rings`. In SVG's downward Y coordinates, outer rings have positive signed area and holes negative. Point-touching cycles are separated into individually simple rings and reported. Exporting a layer preserves the complete viewBox and physical placement. Empty images return no layers; `exportLayer` rejects invalid indices.

### Extension

Implement `Quantizer.quantize(image, resolvedOptions)` and pass it as the third argument to `convertImage`. The result must preserve dimensions and the alpha threshold mask, contain unique integer RGB colors (no more than the requested maximum), obey a supplied filament palette, and return valid `Int8Array` labels. Initialize a WASM engine before calling the synchronous pipeline. The provider is trusted code; it must not mutate input. No registry or WASM download is needed by the built-in implementation.

Exports: `convertImage`, `exportLayer`, `DEFAULT_OPTIONS`, `resolveOptions`, `oklabQuantizer`, and the associated TypeScript types.

## Printing limitations

This produces planar vector artwork, not STL/3MF/G-code or a printability guarantee. By default boundaries are simplified into lines and quadratic Bézier curves on a shared graph. Significant corners and junctions stay fixed. `curveTolerance: 0` retains exact pixel polygons. This option controls polygon simplification and rounding; it is not a certified Hausdorff bound on the final curve. Fitting changes the raster silhouette and area slightly. Sampled intersection/orientation/area checks revert problematic boundaries; tiny or complex contours can remain angular. Above 250,000 source contour vertices the fitting stage is skipped with a warning. These checks are not a proof of CAD topology at arbitrary precision. Area cleanup does not enforce nozzle width, connectivity, thickness, or minimum gaps. Zero-width point contacts and detached islands can require repair or a base before extrusion. Actual slicer imports and physical prints have not been validated in v1. Output is capped at 2 million contour vertices; lower resolution or stronger cleanup helps complex images.

Licensed under MPL-2.0. Oklab matrices are from [Björn Ottosson's public-domain reference](https://bottosson.github.io/posts/oklab/).
