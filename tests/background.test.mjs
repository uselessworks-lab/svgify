import test from 'node:test';
import assert from 'node:assert/strict';
import { convertImage, resolveOptions } from '@uselessworks/svgify';
const options = { colors: 4, minRegionPixels: 0, curveTolerance: 0 };
function fixture(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const white = [255,255,255,255], red = [200,20,30,255], clear = [0,0,0,0];

test('background removal preserves enclosed same-color details, alignment and input bytes', () => {
  const image = fixture(11, 11, (x,y) => x >= 3 && x <= 7 && y >= 3 && y <= 7 && !(x === 5 && y === 5) ? red : white);
  const saved = image.data.slice();
  const before = convertImage(image, options);
  const result = convertImage(image, { ...options, removeBackground: true });
  assert.equal(result.stats.removedBackgroundPixels, 96);
  assert.equal(result.stats.opaquePixels, 25);
  assert.equal(result.labels[0], -1);
  assert.equal(result.palette[result.labels[5*11+5]], '#ffffff');
  assert.equal(result.width, before.width); assert.equal(result.height, before.height);
  assert.equal(result.widthMm, before.widthMm); assert.equal(result.heightMm, before.heightMm);
  assert.deepEqual(image.data, saved);
  assert.equal(convertImage(image, options).svg, before.svg);
});

test('remove background before learning or mapping a constrained palette', () => {
  const image = fixture(16,16,(x,y) => x >= 6 && x < 10 && y >= 6 && y < 10 ? red : white);
  for (const palette of [undefined, ['#c8141e']]) {
    const result = convertImage(image, { ...options, colors: 1, palette, removeBackground: true });
    assert.deepEqual(result.palette, ['#c8141e']);
    assert.equal(result.stats.removedBackgroundPixels, 240);
    assert.equal(result.stats.opaquePixels, 16);
  }
});

test('already transparent and ambiguous borders stay unchanged', () => {
  const images = [
    fixture(12,12,(x,y) => x >= 4 && x < 8 && y >= 4 && y < 8 ? red : clear),
    fixture(12,12,(x,y) => x < 6 ? (y < 6 ? white : red) : (y < 6 ? [0,0,255,255] : [0,200,0,255])),
  ];
  for (const image of images) {
    const result = convertImage(image, { ...options, removeBackground: true });
    assert.equal(result.svg, convertImage(image, options).svg);
    assert.equal(result.stats.removedBackgroundPixels, 0);
    assert.match(result.warnings.join(), /No dominant solid background/);
  }
});

test('background flood is four-connected and matches a fixed color, including small variations', () => {
  const diagonal = fixture(7,7,(x,y) => x === 0 || y === 0 || x === 6 || y === 6 || x === y ? white : red);
  const result = convertImage(diagonal,{...options,removeBackground:true});
  assert.notEqual(result.labels[3*7+3], -1, 'diagonal contact cannot erase an enclosed white detail');
  const noisy = fixture(16,16,(x,y) => x >= 6 && x < 10 && y >= 6 && y < 10 ? red : [(x+y)%2 ? 251 : 255,253,252,255]);
  assert.equal(convertImage(noisy,{...options,removeBackground:true}).stats.removedBackgroundPixels,240);
});

test('uniform, one-dimensional and empty inputs produce valid empty geometry', () => {
  for (const [w,h] of [[1,1],[1,10],[10,1],[10,10]]) {
    const image = fixture(w,h,()=>white);
    const result = convertImage(image,{...options,removeBackground:true});
    assert.equal(result.stats.removedBackgroundPixels,w*h);
    assert.equal(result.layers.length,0); assert.ok(result.labels.every(l=>l===-1));
  }
  const empty = convertImage(fixture(4,4,()=>clear),{removeBackground:true});
  assert.equal(empty.stats.removedBackgroundPixels,0);
  assert.equal(resolveOptions().removeBackground,false);
  assert.throws(()=>resolveOptions({removeBackground:'true'}),/boolean/);
});
