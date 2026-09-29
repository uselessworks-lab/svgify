import type { RasterImage } from './types.js';
/** Area resampling with premultiplied alpha, preventing transparent RGB fringes. */
export function resizeImage(image: RasterImage, maxDimension: number): RasterImage {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  const sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = x*sx, x1 = (x+1)*sx, y0 = y*sy, y1 = (y+1)*sy;
    let alpha = 0, r = 0, g = 0, b = 0;
    for (let iy = Math.floor(y0); iy < Math.ceil(y1); iy++) for (let ix = Math.floor(x0); ix < Math.ceil(x1); ix++) {
      if (ix >= image.width || iy >= image.height) continue;
      const weight = (Math.min(ix+1, x1)-Math.max(ix, x0))*(Math.min(iy+1, y1)-Math.max(iy, y0));
      const p = (iy*image.width+ix)*4, a = image.data[p+3]*weight;
      alpha += a; r += image.data[p]*a; g += image.data[p+1]*a; b += image.data[p+2]*a;
    }
    const p = (y*width+x)*4;
    if (alpha > 0) { data[p] = r/alpha; data[p+1] = g/alpha; data[p+2] = b/alpha; }
    data[p+3] = alpha/(sx*sy);
  }
  return { width, height, data };
}
