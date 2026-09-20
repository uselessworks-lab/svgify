# Architecture and design decisions

## Repository contract

Reference: the local useless works handbook, `docs/technical/project-architecture.md`, revision `765fbe443b5bba953bef720a74be1cd7b81bc11c`, reviewed on 2026-09-19. Adopted layout: `package/core` + `app/*`, apps depend on core, never the reverse. No handbook submodule, sibling file dependency, public website deployment or npm publication was created. A future formal organization adoption can pin the shared handbook. The web surface here is an English-only test editor, not a public landing shell. UI copy, accessibility labels and document metadata are authored in English.

## Source of truth

| Responsibility | Location |
|---|---|
| Public contracts, options, limits, defaults | `package/core/src/types.ts`, `options.ts` |
| Conversion composition, validation, diagnostics | `package/core/src/index.ts` |
| Optional border-connected background removal | `package/core/src/background.ts` |
| Alpha-aware area resampling | `package/core/src/raster.ts` |
| Oklab transform and quantization | `color.ts`, `quantize.ts` |
| Connected-component cleanup | `regions.ts` |
| Raster geometry, orientation, closure, simple rings | `trace.ts` |
| Shared boundary graph, line/curve fitting, collision fallback | `curves.ts` |
| SVG format and physical dimensions | `svg.ts` |
| Extension point | `Quantizer` interface in `types.ts` |
| Node input/output, argument parsing | `app/cli/src/main.ts` |
| Unified source/SVG comparison, zoom, pan and split divider | `app/web/src/preview.ts`, `preview.css` |
| Browser input, state, downloads, UI | `app/web/src/main.ts` |
| Worker transport | `app/web/src/protocol.ts`, `convert.worker.ts` |
| Editor semantic tokens and responsive styles | `app/web/src/style.css` |
| Sample image source | Canvas drawing in `main.ts`; project test art, no external brand asset |
| Package/build contracts | Root/workspace `package.json`, `tsconfig*.json` |
| Invariants, CLI parity, architecture checks | `tests/` |
| Benchmarks | `tools/benchmark.mjs` |

There is one quantizer implementation and one contour strategy. A registry would add ceremony; use the public provider interface if a second implementation is needed. Options belong to core. The web demo deliberately starts with `minRegionAreaMm2: 0.1`; the library defaults to zero to avoid an implicit physical-area cleanup policy for API consumers. There is no persisted document format or server state in v1.

## Optional background removal and comparison UI

`removeBackground` defaults to false and is shared by library, CLI (`--remove-background`) and demo. After resize, `background.ts` averages the dominant 5-bit perimeter RGB bin. More than half of the complete perimeter must lie within fixed Oklab distance 0.05. A four-connected border flood clears alpha for matching pixels, without mutating input or cropping. Enclosed details and existing transparent gaps are preserved. Background-connected similar artwork can also be removed; this is not subject segmentation. Detection failure leaves pixels unchanged and reports a warning. Quantization and geometry operate on the resulting mask; `removedBackgroundPixels` is separate from cleanup `changedPixels`.

The demo owns one shared camera for its canvas source and SVG image. Both get the same rendered dimensions and offset. Split clipping is in viewport coordinates, so changing the divider does not move either image. Each pane has its own opaque checkerboard to prevent the untouched original showing through a removed SVG background. Wheel zoom anchors to the cursor; drag pans, touch pointers also support pinch, buttons and keyboard provide alternatives. New sources reset the camera; mode/settings changes preserve it. Option input cancels obsolete Worker work and schedules one conversion after a 180ms debounce; stale results cannot replace the new request, and invalid form values pause automatic conversion. The manual Convert action remains an immediate retry. Actual SVG CSS dimensions change with zoom rather than magnifying a cached low-resolution transformed image. Palette entries are informational; only combined download is exposed in the demo. Public `exportLayer` and CLI `--layers` remain available for API compatibility.

## Quantization

A 32×32×32 histogram caps clustering work at 32,768 weighted samples. Each bin stores averaged RGB, converted once to Oklab. If the image has at most the requested color count, a separate exact-color path bypasses histogram collisions. Otherwise, deterministic weighted farthest-point seeds feed weighted Lloyd refinement in Oklab. Output centers are converted back to sRGB, rounded and deduplicated. A palette lookup maps pixels without dithering. A fixed filament palette bypasses learning and uses the same nearest-color remapping. Unused colors are removed after cleanup.

This is a fast, deterministic baseline. Bin averaging can discard subtle within-bin variation; the reported RMSE is an approximation before spatial cleanup. It is not a proof of best possible palette or perceptual quality. Rare details can be lost; supplied filament colors allow repeatable material constraints.

Oklab equations: [original author reference](https://bottosson.github.io/posts/oklab/), public-domain code. We evaluated the availability of [libimagequant](https://github.com/ImageOptim/libimagequant) and [VTracer](https://github.com/visioncortex/vtracer). Neither is bundled in v1. The chosen baseline keeps browser/Node output identical for the same RGBA, avoids WASM bootstrap and gives exact control over shared boundaries. No performance comparison against native/WASM engines has been run. A WASM provider is a follow-up only if measurements justify it.

## Region cleanup

Four-connected flood fill creates components. Small components are merged into neighbors using shared-boundary length and Oklab distance. Union/find and linked pixel lists preserve the original mask. Pending components only grow by merging into a component at least as large; already-processed roots can accept merges without being scanned again. This prevents quadratic repeated scans on adversarial inputs. Final connected regions are recounted because recoloring can join additional neighbors of the same color.

Cleanup is conservative and single-pass over candidate components, not a guarantee that every final region exceeds the threshold. It never deletes isolated art, fills transparent holes, or bridges empty space. `remainingSmallRegions` reports actual remaining components. A minimum area in mm² is converted to pixels using the requested output width; it is not a minimum width test.

## Geometry and manufacturing contract

The initial raster tracing stage gives every pixel cell its clockwise exposed edges. Internal same-color edges disappear; unlike stacked color tracing, adjacent colors share the exact same boundary without geometric overlaps. Direction-prioritized edge walks close contours; only collinear points are removed. Repeated junction points are split into individually simple loops. Opposite winding preserves holes with `fill-rule="nonzero"`. The serialized SVG contains only groups and filled paths.

`rings` use processing pixel coordinates; `widthMm / width` is the uniform physical scale. Dimension rounding after resampling can very slightly alter the source aspect ratio. All exported layers share the same complete viewBox. No per-layer crop, opacity, transform, stroke, mask, or image is used.

The default output now fits shared boundaries (`curveTolerance: 1`; 0 preserves the old pixel-edge mode). Raster tracing keeps junction vertices even along collinear runs, so both materials agree on edge segmentation. The fitter deduplicates undirected edges, splits chains at graph junctions, and simplifies each chain once using iterative RDP. Closed chains are split at a deterministic distant point for simplification without forcing an artificial seam corner. Turns of 60° or more remain sharp; smooth vertices become midpoint-based quadratic Bézier segments with limited rounding handles. SVG coordinates are rounded to 0.001 processing pixels before reuse. Opposite materials reverse the very same segment endpoints and controls. No per-color independent fitting occurs.

Collision checks adaptively flatten quadratics at 0.015px flatness and index short segments into an 8px spatial grid. Fitted boundaries are checked against other original boundaries and all fitted boundaries, including nonadjacent pieces of the same chain. Original graph junctions are permitted contacts. Signed quadratic area is integrated analytically; winding reversal, degeneracy or more than 50% area change on a loop rejects its affected chains. Conflicting chains revert to exact pixel polylines, checks repeat, and a bounded final fallback removes all remaining fitted candidates if necessary. This is conservative numerical validation, not a certified analytic curve-intersection or global topology proof. Sub-flatness contacts, extreme nesting and subpixel features still warrant downstream inspection.

Very short chains retain their source detail; inputs above 250,000 source contour vertices skip fitting with a warning. RDP has a bounded work budget for pathological chains. Diagnostics report output path/curve segment counts and fallback boundaries. The public `rings`, `labels`, `pixels`, `areaMm2`, and `stats.vertices` keep their pre-fit raster meaning. `contours` (L/Q segments), `path`, and `vectorAreaMm2` describe the actual exported geometry; consumers performing extrusion should use these. Physical units and layer alignment are unchanged. The processed alpha mask (after optional background removal) stays unchanged in `labels`; the fitted transparent silhouette can deviate near its border.

Straight/curve fitting removes pixel stair steps while preserving significant corners. It changes area and the silhouette slightly; `curveTolerance` is a simplification setting, not a rigorous final Hausdorff error guarantee. Nozzle width, minimum gaps, wall thickness, connected bases, extrusion, and slicer compatibility still need additional work.

## Runtime and packaging

Core compiles with `lib: ES2022`, `types: []`, so accidental DOM/Node globals fail typecheck. It has no runtime dependencies. Browser and CLI import only `@uselessworks/svgify`. CLI owns sharp and native image decoding. Browser owns canvas decoding and a Worker, transfers pixel buffers, terminates obsolete/canceled jobs, and ignores stale responses. File decode requests have a separate sequence token to prevent stale uploads replacing newer sources.

The core package includes ESM, declarations, README and license. CLI is separately publishable with a pinned matching core dependency and a `svgify` binary. Demo is private and absent from both tarballs. `prepack` builds each package; core must exist before building the CLI. `npm run build` enforces order. Public npm naming/ownership and publication are not verified by local packaging.

The repository root also exposes the core ESM and declarations through `main`, `types`, and `exports`. Its `prepare` script builds only the core, allowing `git+https://github.com/uselessworks-lab/svgify.git` to be installed directly without bundling the CLI or demo. The root remains private to prevent accidental npm publication; the independently publishable package manifest remains in `package/core`. The root package name matches the public import name so direct Git installs produce `@uselessworks/svgify` without an alias.
