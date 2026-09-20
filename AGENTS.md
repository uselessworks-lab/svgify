# svgify development

This project references useless works' `package/core` + `app/*` architecture. Read `docs/ARCHITECTURE.md` and `README.md` before changes. The shared handbook has not been mounted as a submodule; the reviewed revision and adoption scope are recorded in the architecture document. Do not add machine-local sibling package dependencies.

- Keep algorithms, defaults, limits, geometry, physical sizing and SVG serialization in `package/core`.
- Apps consume only the public package API. Core must remain independent of Node, DOM, apps and frameworks.
- Preserve the 16-color bound, indexed raster alpha mask, shared material boundaries, closed vector contours, hole winding and layer alignment. Fitting may approximate the silhouette; document its distinction from the raster geometry.
- Fit curves through the shared boundary graph in `curves.ts`. Do not independently smooth color outlines: shared boundaries must remain identical.
- Update public contracts/docs/tests together when output geometry or option semantics change.
- `npm run dev` serves the demo at 127.0.0.1:4020. `npm run verify` is the complete handoff gate; `npm run bench` measures synthetic fixtures.
- Use targeted checks during iteration; run the full gate before handing off core/host changes.
- Generated builds, test downloads, benchmark logs and package tarballs belong under ignored `dist/`, `.runtime/` or `artifacts/`.
- Do not claim physical printability from an SVG or raster round-trip test. Physical prints and slicer/CAD imports need separate evidence.
- No publication/deployment is part of local development unless the user requests it.
