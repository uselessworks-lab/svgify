# svgify

[![CI](https://github.com/uselessworks-lab/svgify/actions/workflows/ci.yml/badge.svg)](https://github.com/uselessworks-lab/svgify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Convert raster images into compact, limited-color SVG artwork for multi-material 3D-printing workflows. svgify reduces an image to at most 16 colors, merges small color regions, and traces aligned closed paths with shared boundaries.

The core is a dependency-free TypeScript library that runs in browsers and Node.js. This repository also contains a Sharp-based CLI and a local Web Worker demo.

> svgify produces planar vector artwork, not STL, 3MF, G-code, or a printability guarantee. Add thickness and validate line width, gaps, connectivity, and slicer compatibility downstream.

## Features

- Deterministic Oklab color quantization with a strict 1–16 color limit
- Optional fixed filament palette
- Border-connected solid background removal
- Conservative small-region cleanup without crossing transparency
- Closed SVG paths with preserved hole winding
- Shared boundaries between adjacent colors
- Line and quadratic Bézier fitting for smoother zoomed output
- Physical width in millimeters and aligned per-color layers
- Browser, Web Worker, Node.js, and CLI support

## Install directly from GitHub

The repository root is an installable package. Git installation runs the core build automatically.

```sh
npm install git+https://github.com/uselessworks-lab/svgify.git
```

Or add it explicitly to `package.json`:

```json
{
  "dependencies": {
    "@uselessworks/svgify": "git+https://github.com/uselessworks-lab/svgify.git#main"
  }
}
```

For reproducible builds, replace `#main` with a release tag or commit SHA. Node.js 22.13 or newer is required when installing from Git because the package is built during installation.

The package is not currently published to the npm registry.

## Library usage

The library accepts unpremultiplied 8-bit sRGB RGBA bytes. Browser `ImageData` can be passed directly.

```ts
import { convertImage } from '@uselessworks/svgify';

const result = convertImage(
  { width, height, data: rgbaBytes },
  {
    colors: 8,
    widthMm: 100,
    maxDimension: 768,
    curveTolerance: 1,
    minRegionPixels: 8,
    minRegionAreaMm2: 0.1,
    removeBackground: false,
    // palette: ['#183f3b', '#f1dfb8', '#dc7248'],
  },
);

console.log(result.svg);
console.log(result.palette);
console.log(result.layers);
console.log(result.stats);
console.log(result.warnings);
```

`convertImage` is synchronous. Run it in a Worker for large browser images, as the demo does.

### Browser decoding

```ts
const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
const canvas = document.createElement('canvas');
canvas.width = bitmap.width;
canvas.height = bitmap.height;

const context = canvas.getContext('2d')!;
context.drawImage(bitmap, 0, 0);
const result = convertImage(context.getImageData(0, 0, canvas.width, canvas.height));
bitmap.close();
```

### Node.js decoding

The core deliberately does not include an image decoder. Use Sharp or another decoder to produce RGBA bytes:

```ts
import sharp from 'sharp';
import { convertImage } from '@uselessworks/svgify';

const { data, info } = await sharp('input.png', {
  limitInputPixels: 40_000_000,
})
  .autoOrient()
  .toColourspace('srgb')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const result = convertImage({ width: info.width, height: info.height, data });
```

## Main options

| Option | Default | Description |
|---|---:|---|
| `colors` | `8` | Maximum output colors, from 1 to 16 |
| `palette` | auto | Optional `#rrggbb[]` filament palette |
| `curveTolerance` | `1` | Boundary simplification in pixels, from 0 to 4; `0` keeps pixel edges |
| `maxDimension` | `768` | Longest processing edge, from 16 to 2048; images are never upscaled |
| `minRegionPixels` | `8` | Merge connected regions smaller than this pixel area |
| `minRegionAreaMm2` | `0` | Additional physical area threshold |
| `widthMm` | `100` | Physical output width; height follows the processed aspect ratio |
| `removeBackground` | `false` | Remove a dominant solid color connected to the image border |
| `alphaThreshold` | `128` | Pixels below this alpha become empty space |
| `matte` | `#ffffff` | Matte for retained translucent pixels |

See [the core package documentation](package/core/README.md) for the complete result contract, geometry semantics, custom quantizers, and limitations.

## CLI

The CLI lives in a separate workspace and uses Sharp for decoding.

```sh
npm ci
npm run build
npm run cli -- image.png --colors 8 --width-mm 100 -o output.svg
npm run cli -- image.png --remove-background -o transparent.svg
npm run cli -- image.png --colors 3 \
  --palette '#183f3b,#f1dfb8,#dc7248' \
  --report result.json -o output.svg
```

Existing files are not overwritten unless `--force` is supplied. `--output -` writes SVG to stdout and diagnostics to stderr. Run `npm run cli -- --help` for every option.

## Web demo

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:4020](http://127.0.0.1:4020). The English-only demo processes images locally in the browser and exposes Original, SVG, and Split views with synchronized zoom and pan. Conversion options update the preview automatically after a short debounce.

## Repository layout

```text
package/core/  @uselessworks/svgify library source and publishable package
app/cli/       @uselessworks/svgify-cli, Node.js + Sharp
app/web/       private Vite/Web Worker demo
tests/         core invariants and CLI integration tests
tools/         reproducible performance benchmark
docs/          architecture and validation records
```

Algorithms, defaults, geometry, physical sizing, and SVG serialization live in `package/core`. Apps consume the public core API and never the reverse. The root manifest re-exports the built core so this Git repository can be installed directly as `@uselessworks/svgify`.

## Development

```sh
npm ci
npm run verify   # typecheck, 24 tests, core/CLI/demo production builds
npm run bench
```

Generated builds, benchmark output, and package tarballs belong in ignored `dist/`, `artifacts/`, or `.runtime/` directories.

Design details are recorded in [Architecture](docs/ARCHITECTURE.md) and evidence from the current implementation is in [Validation](docs/VALIDATION.md).

## License

svgify is licensed under the [MIT License](LICENSE).

You may use, copy, modify, distribute, sublicense, and sell the software, including as part of private or proprietary products. Copies or substantial portions must retain the copyright and license notice. MIT does not require modified source code to be published.

This summary is informational; the license text controls. See the [OSI license page](https://opensource.org/license/mit) for the standard MIT terms.
