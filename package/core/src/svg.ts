import type { ColorLayer } from './types.js';
export function serializeSvg(layers: readonly ColorLayer[], width: number, height: number, widthMm: number): string {
  const heightMm = widthMm*height/width;
  const paths = layers.map(layer => `  <g id="${layer.id}" data-color="${layer.color}"><path fill="${layer.color}" fill-rule="nonzero" d="${layer.path}"/></g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${Number(heightMm.toFixed(6))}mm" viewBox="0 0 ${width} ${height}">\n${paths.join('\n')}\n</svg>`;
}
