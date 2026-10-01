import test from 'node:test';
import assert from 'node:assert/strict';
import { convertImage } from '@uselessworks/svgify';
import { quantizeColors, quantizeSvgColors } from '@uselessworks/svgify/colors';

test('SVG color remapping preserves all geometry, holes, transforms and source formatting', () => {
  const svg = `<svg viewBox='0 0 100 50' xmlns="http://www.w3.org/2000/svg"><!-- fill='#abcdef' -->
<g transform="translate(1,2)" fill="#ff0000"><path d="M0 0C1 2 3 4 5 6Z M1 1L2 2Z" fill-rule="evenodd" stroke='#00ff00'/>
<path data-note="fill='#abcdef' >" d="M7 8Q9 10 11 12Z" style="fill: #0000ff; stroke-width: 1; opacity: .5"/></g></svg>`;
  const result = quantizeSvgColors(svg, { colors: 1, palette: ['#123456'] });
  assert.equal(result.svg, svg.replace('fill="#ff0000"', 'fill="#123456"')
    .replace("stroke='#00ff00'", "stroke='#123456'").replace('fill: #0000ff', 'fill: #123456'));
  assert.deepEqual(result.palette, ['#123456']);
});

test('limited SVG palettes remain byte-identical; alpha and paint references survive remapping', () => {
  const svg = '<svg><path fill="#f00" stroke="rgb(0, 255, 0)"/>'
    + '<path style="fill: rgba(0,0,255,.25) !important;stroke: none" opacity=".4"/>'
    + '<path fill="url(#ink)" stroke="currentColor"/></svg>';
  assert.equal(quantizeSvgColors(svg, { colors: 3 }).svg, svg);
  const remapped = quantizeSvgColors(svg, { colors: 1, palette: ['#123456'] }).svg;
  assert.ok(remapped.includes('fill: rgba(18,52,86,0.25) !important'));
  assert.ok(remapped.includes('opacity=".4"'));
  assert.ok(remapped.includes('fill="url(#ink)" stroke="currentColor"'));
  assert.ok(remapped.includes('stroke: none'));
});

test('vector swatches share raster palette learning and support area weights', () => {
  const samples = [ { color: '#ff0000', weight: 5 }, { color: '#00ff00', weight: 3 }, { color: '#0000ff', weight: 2 } ];
  const data = Uint8Array.from(samples.flatMap(sample => Array.from({ length: sample.weight }, () =>
    [...sample.color.slice(1).match(/../g).map(value => parseInt(value, 16)), 255])).flat());
  const raster = convertImage({ width: 10, height: 1, data }, { colors: 2, minRegionPixels: 0, curveTolerance: 0 });
  const vector = quantizeColors(samples, { colors: 2 });
  assert.deepEqual(vector.palette, raster.palette);
  assert.deepEqual(vector, quantizeColors(samples, { colors: 2 }));
  assert.equal(vector.mapping.length, 3);
  assert.equal(quantizeColors([{ color: '#010203' }, { color: '#020304' }], { colors: 2 }).palette.length, 2);
  assert.throws(() => quantizeColors(samples, { colors: 17 }));
  assert.throws(() => quantizeColors([{ color: '#ff0000', weight: 0 }]));
});

test('additional CSS colors use a neutral resolver; inline comments and stylesheet failures are explicit', () => {
  const result = quantizeSvgColors('<svg><path fill="red" style="/* fill: #ffffff; */ stroke: blue"/></svg>',
    { colors: 1, palette: ['#123456'], resolveColor: color => ({ red: [255, 0, 0], blue: [0, 0, 255] })[color] });
  assert.ok(result.svg.includes('/* fill: #ffffff; */'));
  assert.deepEqual(result.palette, ['#123456']);
  assert.throws(() => quantizeSvgColors('<svg><style>path {fill:red}</style></svg>'), /stylesheets/);
  assert.throws(() => quantizeSvgColors('<svg><path fill="unknown"/></svg>'), /Unsupported SVG color/);
});
