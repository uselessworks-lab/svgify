import { parseHex, toHex } from './options.js';
import { quantizeColors } from './quantize.js';
import type { RGB, SvgColorQuantizationOptions, SvgColorQuantizationResult } from './types.js';

interface Paint { readonly start: number; readonly end: number; readonly color: string; readonly alpha?: string }
const PAINT = /^(?:fill|stroke|color|stop-color|flood-color)$/i;

function colorValue(value: string, resolve?: SvgColorQuantizationOptions['resolveColor']):
  { color: string; alpha?: string } | undefined {
  if (/^(?:none|currentcolor|inherit|initial|unset|revert|transparent|context-fill|context-stroke)$|^(?:url|var)\(/i.test(value))
    return undefined;
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(char => char + char).join('') : hex[1];
    return { color: '#' + digits.slice(0, 6).toLowerCase(),
      ...(digits.length === 8 ? { alpha: String(parseInt(digits.slice(6), 16) / 255) } : {}) };
  }
  const rgb = /^rgba?\(\s*([^()]*)\s*\)$/i.exec(value);
  if (rgb) {
    const channels = rgb[1].trim().split(/[\s,\/]+/);
    if (channels.length !== 3 && channels.length !== 4) throw new TypeError('Invalid SVG RGB color.');
    const channel = (text: string, maximum: number) => {
      const number = Number(text.endsWith('%') ? text.slice(0, -1) : text);
      if (!Number.isFinite(number)) throw new TypeError('Invalid SVG RGB color.');
      return Math.max(0, Math.min(maximum, number * (text.endsWith('%') ? maximum / 100 : 1)));
    };
    return { color: toHex(channels.slice(0, 3).map(text => Math.round(channel(text, 255))) as unknown as RGB),
      ...(channels[3] === undefined ? {} : { alpha: String(channel(channels[3], 1)) }) };
  }
  // Default SVG fill is black; named colors remain an optional environment-independent port.
  const resolved = value.toLowerCase() === 'black' ? [0, 0, 0] : resolve?.(value);
  if (!resolved || resolved.length !== 3 || resolved.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255))
    throw new TypeError(`Unsupported SVG color: ${value}. Supply resolveColor for additional CSS colors.`);
  return { color: toHex(resolved as RGB) };
}

/**
 * Remap explicit solid paint declarations, leaving every other source byte intact.
 * Hex and rgb()/rgba() paints are built in; additional CSS colors use resolveColor.
 * References, implicit/inherited defaults, alpha and opacity are preserved. This
 * does not render CSS/gradients or promise a bound on the resulting rendered colors.
 */
export function quantizeSvgColors(svg: string, options: SvgColorQuantizationOptions = {}): SvgColorQuantizationResult {
  if (typeof svg !== 'string') throw new TypeError('Expected SVG text.');
  const paints: Paint[] = [];
  const collect = (value: string, offset: number) => {
    const trimmed = value.trim(), important = /\s*!important\s*$/i.exec(trimmed);
    const paint = important ? trimmed.slice(0, important.index).trimEnd() : trimmed;
    if (!paint) return;
    const parsed = colorValue(paint, options.resolveColor);
    if (parsed) paints.push({ start: offset + value.indexOf(trimmed),
      end: offset + value.indexOf(trimmed) + paint.length, ...parsed });
  };
  // Quoted '>' characters and comments must never be mistaken for paint attributes.
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  for (const token of svg.matchAll(tokens)) {
    if (/^<\s*(?:!|\?|\/)/.test(token[0])) continue;
    // Stylesheets require a CSS cascade, beyond source-level solid-paint remapping.
    if (/^<\s*style\b/i.test(token[0])) throw new TypeError('SVG stylesheets are unsupported; use paint attributes or inline styles.');
    const attributes = /([^\s=<>/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    for (const attribute of token[0].matchAll(attributes)) {
      const value = attribute[3] ?? attribute[4];
      const offset = token.index! + attribute.index! + attribute[0].length - value.length - 1;
      if (PAINT.test(attribute[1])) collect(value, offset);
      else if (attribute[1].toLowerCase() === 'style') {
        const declarations = /(?:^|;)\s*(fill|stroke|color|stop-color|flood-color)\s*:\s*([^;]*)/gi;
        for (const declaration of value.replace(/\/\*[\s\S]*?\*\//g, comment => ' '.repeat(comment.length)).matchAll(declarations))
          collect(declaration[2], offset + declaration.index! + declaration[0].length - declaration[2].length);
      }
    }
  }
  const result = quantizeColors(paints.map(paint => ({ color: paint.color })), options);
  const mapping = new Map(result.mapping.map(({ from, to }) => [from, to]));
  // Exact palettes preserve the original color spelling; edited spans are joined
  // once so large SVGs do not repeatedly copy the entire document.
  const chunks: string[] = [];
  let cursor = 0;
  for (const paint of paints) {
    const color = mapping.get(paint.color)!;
    if (color === paint.color) continue;
    const replacement = paint.alpha === undefined ? color
      : `rgba(${parseHex(color).join(',')},${paint.alpha})`;
    chunks.push(svg.slice(cursor, paint.start), replacement);
    cursor = paint.end;
  }
  chunks.push(svg.slice(cursor));
  return { svg: chunks.join(''), ...result };
}
