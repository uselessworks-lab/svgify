#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, basename, join } from 'node:path';
import sharp from 'sharp';
import { convertImage, exportLayer } from '@uselessworks/svgify';
import type { ConvertOptions } from '@uselessworks/svgify';
const help = `svgify — image to limited-color SVG

Usage: svgify <input.png> [--output output.svg] [options]

  --colors 8              Maximum colors (1–16)
  --palette '#112233,#ffffff'  Available filament colors (#rrggbb)
  --curve-tolerance 1    Simplify boundaries in pixels; 0 keeps pixel edges
  --width-mm 100          Physical output width
  --max-dimension 768     Longest processing edge (16–2048)
  --min-region-pixels 8   Merge smaller connected regions (0 disables)
  --min-region-mm2 0      Additional minimum region area in mm²
  --iterations 10        Quantizer refinement passes (1–30)
  --alpha-threshold 128  Transparent cutoff (1–255)
  --matte '#ffffff'      Background for remaining partial alpha
  --remove-background   Remove border-connected dominant solid background
  --layers <directory>  Write aligned per-color SVG files
  --report <file.json>  Write palette, geometry statistics and warnings
  --output, -o <path>    Default: input filename with .svg; '-' for stdout
  --force               Allow overwriting output files
  --help, -h            Show help

PNG, JPEG, WebP and other raster formats supported by sharp.
Animated inputs use the first frame. SVG/PDF inputs are not accepted.
Output is planar vector artwork for extrusion, not a sliced 3D model.
`;
async function main() {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    output: { type: 'string', short: 'o' }, colors: { type: 'string' }, palette: { type: 'string' },
    'curve-tolerance': { type: 'string' }, 'width-mm': { type: 'string' }, 'max-dimension': { type: 'string' }, 'min-region-pixels': { type: 'string' },
    'min-region-mm2': { type: 'string' }, iterations: { type: 'string' }, 'alpha-threshold': { type: 'string' },
    'remove-background': { type: 'boolean' }, matte: { type: 'string' }, layers: { type: 'string' }, report: { type: 'string' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (v.help) { process.stdout.write(help); return; }
  if (positionals.length !== 1) throw new Error('Provide exactly one input image. Use --help for usage.');
  const input = resolve(positionals[0]);
  const output = v.output ?? input.slice(0, input.length-extname(input).length)+'.svg';
  if (output !== '-' && resolve(output) === input) throw new Error('Input and output must be different files.');
  if (v.report && (resolve(v.report) === input || (output !== '-' && resolve(v.report) === resolve(output)))) throw new Error('Report must have a separate output path.');
  const options: ConvertOptions = {};
  const numeric = { colors: 'colors', 'curve-tolerance': 'curveTolerance', 'width-mm': 'widthMm', 'max-dimension': 'maxDimension', 'min-region-pixels': 'minRegionPixels', 'min-region-mm2': 'minRegionAreaMm2', iterations: 'iterations', 'alpha-threshold': 'alphaThreshold' } as const;
  for (const [flag, name] of Object.entries(numeric)) {
    const raw = v[flag as keyof typeof numeric];
    if (raw !== undefined) { if (!raw.trim()) throw new Error(`${flag} requires a number.`); options[name] = Number(raw); }
  }
  if (v.palette !== undefined) options.palette = v.palette.split(',').map(c=>c.trim());
  if (v.matte !== undefined) options.matte = v.matte;
  if (v['remove-background'] !== undefined) options.removeBackground = v['remove-background'];
  const start = performance.now();
  const bytes = await readFile(input);
  const decoder = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error', animated: false });
  const metadata = await decoder.metadata();
  if (metadata.format === 'svg' || metadata.format === 'pdf') throw new Error('Please supply a raster image (PNG, JPEG or WebP).');
  const { data, info } = await decoder.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = convertImage({ data, width: info.width, height: info.height }, options);
  const elapsedMs = performance.now()-start;
  const flag = v.force ? 'w' : 'wx';
  if (output === '-') process.stdout.write(result.svg+'\n'); else await writeFile(output, result.svg, { flag });
  if (v.layers) {
    await mkdir(v.layers, { recursive: true });
    for (let i=0; i<result.layers.length; i++) {
      const layer = result.layers[i];
      await writeFile(join(v.layers, `${layer.id}-${layer.color.slice(1)}.svg`), exportLayer(result, i), { flag });
    }
  }
  if (v.report) await writeFile(v.report, JSON.stringify({ source: basename(input), widthMm: result.widthMm, heightMm: result.heightMm, palette: result.palette, stats: result.stats, elapsedMs, warnings: result.warnings }, null, 2)+'\n', { flag });
  process.stderr.write(`${result.stats.colors} colors · ${result.stats.regions} regions · ${result.stats.pathSegments} segments (${result.stats.curveSegments} curves) · ${elapsedMs.toFixed(0)} ms\n`);
  for (const warning of result.warnings) process.stderr.write(`Warning: ${warning}\n`);
}
main().catch(error => { process.stderr.write(`svgify: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
