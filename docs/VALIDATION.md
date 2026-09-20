# Curve vectorization update — 2026-09-19

The entries below describe the current default curve output. The original pixel-mode baseline is retained afterward as historical evidence.

## Verification

- `npm run verify`: all workspace typechecks, **18 tests**, and production builds passed.
- New tests cover compact quadratic circle reconstruction (radial RMS <1 processing pixel), diagonal-line reduction, preservation of hard rectangular corners, reversed identical shared material curves, complete three-color coverage across junctions, thin concentric bands, small islands, invalid curve settings, exact-mode compatibility, and cycles returning to pinned junctions.
- Independent sharp rendering accepts the generated quadratic geometry and reproduces expected interior/background colors.
- The initial exact pixel-raster round-trip tests now explicitly use `curveTolerance: 0`; the indexed raster itself remains unchanged when fitting is enabled.
- Thin two-pixel rings at tolerance 4 exercised the collision fallback and preserved the hole. The one-pixel digital ring fixture contains disconnected pieces already in its raster; its component count is compared with the exact mode rather than incorrectly assuming a connected ring.
- `npm pack` refreshed both local packages with the curve implementation, declarations and new option documentation. Compressed sizes: core ~28.4KB, CLI ~5.1KB. No publication performed. The isolated install record below belongs to the earlier baseline.

## Actual browser result

- Tested the live demo's `곡선 단순화` slider by keyboard: 0 (exact), 1 (default), and 4 (stronger simplification).
- Sample at 720×720: exact mode **6,692 path segments / 52.1KB / 0 curves**; default **856 segments / 14.1KB / 640 quadratic commands**. Palette and indexed raster are unchanged.
- Default conversion observed at approximately 120ms in one warm in-app-browser run. This is an observation, not a benchmark guarantee; cold worker/JIT starts can take longer.
- Actual downloaded SVG was read from disk: 14,420 bytes, seven material paths, 640 `Q` commands. Curves are in the exported SVG, not a CSS or preview-only effect.
- Console check during the new demo flows returned no warnings/errors.
- Rendered a generated circle fixture at 6× size and inspected an enlarged before/after crop. The comparison artifact is `.runtime/curve-comparison.png` (left exact / right fitted). This is a rendered test fixture, not a physical print or product photograph.

## Updated benchmark

Apple M4, macOS arm64, Node v24.19.0; same synthetic fixtures, one warm-up and median of five measured runs. Default curve fitting and conservative collision checks are included. Decode, worker startup/transfer and display remain excluded.

| Resolution | Fixture | Median ms | Path segments | Quadratic segments | Fallback boundaries | SVG KB |
|---|---|---:|---:|---:|---:|---:|
| 256×256 | flat | 36.3 | 64 | 0 | 0 | 2.1 |
| 256×256 | gradient-noise | 37.8 | 2474 | 220 | 0 | 22 |
| 512×512 | flat | 27.7 | 64 | 0 | 0 | 2.1 |
| 512×512 | gradient-noise | 114.4 | 8199 | 590 | 10 | 73.6 |
| 768×768 | flat | 60.6 | 64 | 0 | 0 | 2.1 |
| 768×768 | gradient-noise | 184.3 | 17533 | 1360 | 22 | 161.1 |
| 1024×1024 | flat | 110.2 | 64 | 0 | 0 | 2.1 |
| 1024×1024 | gradient-noise | 295.8 | 30305 | 2166 | 42 | 280.4 |

Smoothing and collision checks add work compared with exact tracing. The 768px gradient/noise case is approximately 184ms in this run, with ~161KB output versus ~319KB in the initial exact-mode baseline. Inputs with more than 250,000 original contour vertices skip fitting with a warning to bound graph memory/work.

## Limits

Quadratic fitting approximates the silhouette; `curveTolerance` is not a certified final Hausdorff bound. Collision detection uses adaptive curve flattening, not analytic root isolation, and is not a formal CAD topology proof. Some short, narrow or conflicting boundaries retain pixel detail. No slicer/CAD import or actual printer output was tested. The follow-up browser test covered the changed controls and exports, not a new full cross-browser or responsive audit.

---

# Initial pixel-contour baseline — 2026-09-19

## Automated checks

- `npm run verify`: passed (all workspace typechecks, 12 Node tests, core/CLI/web production builds).
- Core contracts: strict 1–16 color limit; supplied filament palette; exact low-color artwork including histogram collisions; alpha cutoff and matte; transparent input; resize alpha correctness; no input mutation; option and custom-provider validation.
- Geometry: all 512 binary 3×3 masks, diagonal contacts, holes, nested regions and narrow strokes; every pixel is covered by exactly its material or remains transparent. Signed polygon areas match raster areas. Individual rings contain no repeated junction vertex.
- Independent rendering: 24 deterministic random multicolor fixtures rasterized from SVG through sharp and compared pixel-for-pixel.
- CLI: actual image decode, exact core parity, mm sizes, aligned layer exports, JSON report, stdout/stderr separation, invalid input/arguments, protected output overwrite.
- Boundary check: no runtime core dependencies or app/Node/DOM imports; ES-only core typecheck.
- Adversarial cleanup: a 256×256 checkerboard (65,536 original components), minimum area 65,536 pixels, merged to one four-vertex region in approximately 36ms on this machine. This is a single observation, not a benchmark guarantee.

## Package verification

- `npm pack` built both packages. Core tarball: approximately 19.1KB compressed / 71.4KB unpacked; CLI: 4.9KB / 13.1KB.
- Actual tarballs installed into a separate `/private/tmp` consumer using npm, without workspace symlinks.
- Imported the public core package, converted pixels, exported a layer, and typechecked an external TypeScript consumer.
- Executed the installed `node_modules/.bin/svgify` binary against a PNG; produced SVG and report (two colors, 16 vertices, 100×62.5mm).
- Inspected package file lists: demo, tests and workspace configuration are not shipped.
- Initial sharp 0.34.5 dependency was upgraded to 0.35.4 after npm audit. Install audit after upgrade reported zero vulnerabilities.
- No npm publication or external deployment performed.

## Browser checks

Verified in the Codex in-app browser against the actual Vite development server and production preview:

- Sample raster converted through the real Web Worker; result SVG loaded successfully.
- Supplied three-color filament palette restricted the result to those colors.
- Invalid palette showed an error and disabled export; corrected input converted successfully.
- PNG file picker loaded a 32×20 RGBA fixture with a transparent hole. Automatic palette restored its exact two source colors; output was 100×62.5mm.
- Whole-SVG and one-color download buttons produced files in the browser download folder; read back files to verify three paths versus one path, identical 720×720 viewBox. Browser download-event instrumentation timed out, but actual saved files were present and inspected.
- Changing settings invalidated the old download and automatically recomputed the preview after a short debounce.
- Keyboard manipulation of the color slider to 16 worked in the production build.
- Layout inspected at 1280px desktop, 820px tablet, 390px and 320px mobile; document width equaled viewport width at narrow sizes (no horizontal overflow).
- Browser console check returned no warnings/errors during tested flows.
- Preview worker bundle: approximately 11.9KB; main JS approximately 12.3KB; CSS approximately 9.4KB (uncompressed Vite output).

## Performance

Machine: Apple M4, darwin/arm64, Node v24.19.0.

`npm run bench`: one warm-up and five measured conversions per case; median elapsed time includes resampling/quantization/cleanup/tracing/serialization in core, excludes file decode, worker startup/transfer and display. 16-color maximum, 10 iterations, minimum component area 8 pixels. Inputs are synthetic; concurrent machine work and JIT/GC affect results.

| Resolution | Fixture | Median ms | Min–max ms | Colors | Vertices | SVG KB |
|---|---|---:|---:|---:|---:|---:|
| 256×256 | flat | 19.2 | 15.8–26.6 | 16 | 64 | 2 |
| 256×256 | gradient-noise | 27.4 | 20–42.9 | 16 | 6354 | 46.3 |
| 512×512 | flat | 27.1 | 24.3–33.5 | 16 | 64 | 2 |
| 512×512 | gradient-noise | 48.2 | 31.7–81.6 | 16 | 19596 | 148.9 |
| 768×768 | flat | 52.7 | 52.1–54.7 | 16 | 64 | 2 |
| 768×768 | gradient-noise | 94.7 | 69.3–104.7 | 16 | 41546 | 318.8 |
| 1024×1024 | flat | 102.4 | 97.6–111.3 | 16 | 64 | 2 |
| 1024×1024 | gradient-noise | 139.8 | 126.4–145.1 | 16 | 72244 | 559.3 |

Flat inputs retain all 16 source colors exactly. A separate 16-color grayscale ramp test requires RGB RMSE < 7 channel values and histogram Oklab RMSE × 100 < 2.5. The colored gradient/noise benchmark has Oklab error around 5.7–5.8 before region cleanup; this is an approximate objective metric, not a claim of photographic fidelity.

## Not verified / next quality work

- No actual printer output, CAD import, slicer import, extrusion, 3MF/STL conversion, nozzle-width/gap check or physical dimensional measurement.
- No representative photograph corpus, perceptual user study, rare-color semantic preservation test, or comparison against native/WASM alternatives.
- At this initial baseline, no Bézier fitting or shared-boundary smoothing was implemented. Superseded by the update above.
- No cross-browser Safari/Firefox/Chrome matrix, mobile device memory profiling, automated screen-reader audit, 200% browser zoom test, or exhaustive upload/cancel race E2E suite.
- Browser checks were manual tool-driven checks, not a committed browser automation suite.
- Public npm scope ownership and install from the public registry are unverified because these packages have not been published.

## Unified preview and optional background removal — 2026-09-19

- `npm run verify`: all workspace typechecks, 23 tests and production builds passed.
- Added core regressions for enclosed same-color details, fixed/learned palette behavior after removal, input immutability and opt-out restoration, dimensions/placement, transparent and ambiguous borders, four-connected diagonal separation, minor background variations, uniform/one-dimensional/empty inputs and boolean validation. CLI PNG output with `--remove-background` matches core output.
- Browser checks at localhost: original/SVG/split modes, 125% button zoom, 340% wheel zoom, paired-image drag (+70px/+40px), divider drag to 70%, slider keyboard Home/Shift+ArrowRight, zoom reset to fitted 100%, and background toggle auto-conversion. Source and SVG DOM rectangles remained identical during zoom/pan; split movement left them unchanged. Background conversion retained the existing zoom. Palette contains no download buttons.
- A 390×844 viewport had no horizontal overflow; mode buttons, zoom controls and single preview remained usable. Viewport override was reset after checking. Browser console reported no errors during the final check.
- Sample with removal: 226,251 processing pixels removed, 6 colors, 560 path segments (382 curves), 9.0KB SVG. This is a local sample, not a general image-quality or performance benchmark. Checkerboard transparency was inspected in the SVG-only and split views.
- Touch pinch support is implemented but was not exercised on physical touch hardware. No slicer import or physical print was performed for this change.

## Automatic web preview updates — 2026-09-19

- Every conversion control now schedules a preview update after a 180ms debounce. New input terminates obsolete Worker work and increments the request token, so an older response cannot replace the latest settings.
- Native form validation pauses automatic conversion for incomplete numeric values. The previous preview can remain visible while editing, but its download is disabled until a current conversion succeeds. The Convert button remains available for an immediate manual retry.
