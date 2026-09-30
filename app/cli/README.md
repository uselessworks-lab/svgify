# @uselessworks/svgify-cli

Node.js CLI for `@uselessworks/svgify`. Requires Node.js 22.13+. This workspace is private and uses the repository root library during development; it has not been published.

```sh
svgify input.png --colors 8 --curve-tolerance 1 --width-mm 100 -o output.svg
svgify input.jpg --colors 3 --palette '#183f3b,#f1dfb8,#dc7248' --layers ./layers -o output.svg
svgify input.webp --max-dimension 1024 --min-region-pixels 12 --min-region-mm2 0.1 --report report.json -o output.svg
svgify --help
```

Supports raster formats decoded by sharp (PNG, JPEG, WebP and others). EXIF orientation is applied and input is converted to sRGB RGBA. Animated inputs use the first frame. SVG/PDF inputs are rejected. Maximum decoded input: 40MP.

Default output is the input basename with `.svg`. Existing output files are refused unless `--force` is set. `-o -` writes SVG to stdout; stats/errors go to stderr. Errors exit with status 1. Outputs are written sequentially: a later report/layer failure can leave earlier output files in place. Combined SVG and separate color SVGs share origin, physical scale and viewBox.

The output needs extrusion and geometry checks before printing. Area-based cleanup is not a minimum line-width or physical printability check. svgify is MIT-licensed; the sharp dependency is Apache-2.0 and includes its own third-party notices.

Boundaries use shared line/quadratic Bézier paths by default. `--curve-tolerance 0` retains exact pixel edges; 1–4 increases simplification. `--curve-quality high` enables slower least-squares cubic Bézier fitting for smoother zoomed edges. `--curve-smoothing 1` sets Gaussian edge denoising (0–3 processing px); try 1–2 for noisy edges, or 0 to disable. Major corners and junctions stay pinned. Larger values can soften fine detail. `--curve-tolerance 0` overrides either quality mode and retains pixel edges. JSON reports include path and curve counts and the number of boundaries that fell back to pixel detail.

Use `--remove-background` to remove a dominant solid background connected to the image border before quantization. Matching uses resized original RGB colors with Oklab distance `--background-tolerance 0.015`, independent of palette reduction. Lower this value to protect very pale foreground; increase it to accept more background variation. Enclosed same-color details are retained. This is not photographic subject segmentation; no detected dominant background leaves the image unchanged with a warning. The JSON report includes `stats.removedBackgroundPixels`.
