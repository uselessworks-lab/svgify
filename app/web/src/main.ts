import { DEFAULT_OPTIONS } from '@uselessworks/svgify';
import type { ConversionResult, RasterImage } from '@uselessworks/svgify';
import type { Request, Response } from './protocol';
import './style.css';
import { createPreview, previewMarkup } from './preview.js';
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
<header class="topbar"><a class="wordmark" href="./" aria-label="SVGIFY home">svgify<span>↗</span></a><span class="top-label">IMAGE → MATERIAL</span><span class="version">LOCAL DEMO / 0.1</span></header>
<main>
  <section class="intro"><div><p class="eyebrow">LESS COLOR. MORE POSSIBILITY.</p><h1>From image<br><span>to material.</span></h1></div><p class="intro-copy">Reduce your image to 16 colors or fewer.<br>Turn each color into closed SVG paths.<br><small>Your images stay in this browser.</small></p></section>
  <div class="workspace">
    <aside class="controls" aria-label="Conversion settings">
      <div class="section-label"><span>01 / SOURCE</span><button id="sample" class="text-button" type="button">Load sample ↗</button></div>
      <label class="upload" id="drop"><input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"><span class="upload-icon">＋</span><strong>Choose an image</strong><span>or drop it here</span><small>PNG · JPG · WebP / up to 40MP, 30MB</small></label>
      <p id="filename" class="filename">Sample: Landscape study</p>
      <form id="settings">
        <div class="background-option"><label class="background-toggle" for="remove-background">Remove background<input id="remove-background" type="checkbox" role="switch" aria-describedby="background-help"></label><p id="background-help" class="hint">Removes a solid background connected to the image border. Does not isolate subjects in complex photos.</p></div>
        <div class="section-label"><span>02 / MATERIALS</span><output id="color-value" for="colors">8 COLORS</output></div>
        <label class="field">Maximum colors<input id="colors" name="colors" type="range" min="1" max="16" value="${DEFAULT_OPTIONS.colors}"></label><div class="range-labels"><span>1</span><span>16</span></div>
        <label class="field">Filament palette <span class="optional">optional</span><textarea id="palette-input" rows="2" placeholder="#183f3b, #f4e7c6, #de784c" aria-describedby="palette-help"></textarea></label><p id="palette-help" class="hint">Leave empty to extract colors. Use comma-separated #rrggbb values.</p>
        <div class="section-label divided"><span>03 / GEOMETRY</span><span>mm</span></div>
        <div class="field-grid"><label class="field">Width (mm)<input id="width" type="number" min="0.1" max="10000" step="0.1" value="${DEFAULT_OPTIONS.widthMm}" required></label><label class="field">Min. area (mm²)<input id="area" type="number" min="0" max="100000000" step="0.01" value="0.1" required></label></div>
        <label class="field">Merge small regions <span class="optional">pixel area</span><input id="regions" type="number" min="0" max="4194304" step="1" value="${DEFAULT_OPTIONS.minRegionPixels}" required></label>
        <label class="field" for="curve-tolerance">Curve simplification <output id="curve-value" for="curve-tolerance">${DEFAULT_OPTIONS.curveTolerance} px</output><input id="curve-tolerance" type="range" min="0" max="4" step="0.1" value="${DEFAULT_OPTIONS.curveTolerance}"></label><p class="hint">0 preserves pixel edges. Higher values simplify small bends into lines and curves.</p>
        <label class="field">Processing resolution<select id="resolution"><option value="384">384 px · Fast</option><option value="768" selected>768 px · Balanced</option><option value="1024">1024 px · Detailed</option><option value="1536">1536 px · High resolution</option></select></label>
        <button id="convert" class="primary" type="submit">Convert <span>↗</span></button>
        <button id="cancel" type="button" class="secondary" hidden>Cancel conversion</button>
      </form>
      <p class="footnote">Merges small regions by area. This does not check minimum line width or guarantee printability.</p>
    </aside>
    <section class="studio" aria-label="Image preview">
      <div class="studio-top"><span class="section-label">CONVERSION STUDIO</span><span class="local-badge">● ON YOUR DEVICE</span></div>
      ${previewMarkup}
      <div class="statusline"><p id="status" role="status" aria-live="polite">Preparing sample…</p><span id="timing">—</span></div>
      <div class="metrics"><div><span>COLORS</span><strong id="stat-colors">—</strong></div><div><span>REGIONS</span><strong id="stat-regions">—</strong></div><div><span>PATH SEGMENTS</span><strong id="stat-vertices">—</strong></div><div><span>SVG SIZE</span><strong id="stat-size">—</strong></div></div>
      <section class="palette-section"><div class="section-label"><span>MATERIAL LAYERS</span><span>Colors · area share</span></div><div id="palette" class="palette"></div></section>
      <div id="warnings" class="warnings" hidden></div>
      <div class="export-bar"><p>Color groups · closed paths · millimeters<br><small>Import the SVG into a modeling tool to add thickness.</small></p><button id="download" class="primary" disabled>Download SVG ↓</button></div>
    </section>
  </div>
  <footer><span>svgify / a useless works experiment</span><span>Planar artwork, ready for your next dimension.</span></footer>
</main>`;
function $<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const canvas = $<HTMLCanvasElement>('original'), status = $('status');
const controls = $<HTMLFormElement>('settings');
const preview = createPreview(root);
let source: RasterImage | undefined, result: ConversionResult | undefined;
let worker: Worker | undefined, job = 0, loadId = 0, svgUrl = '', outputName = 'landscape';
let conversionTimer: number | undefined, settingsDirty = false;
function setBusy(busy: boolean) {
  $('result-preview').setAttribute('aria-busy', String(busy));
  $<HTMLButtonElement>('convert').disabled = busy;
  $('cancel').hidden = !busy;
  $<HTMLButtonElement>('download').disabled = busy || settingsDirty || !result;
}
function clearResult() {
  result = undefined; if (svgUrl) URL.revokeObjectURL(svgUrl); svgUrl = '';
  settingsDirty = false;
  preview.setResult(null);
  $('palette').replaceChildren(); $('warnings').hidden = true;
  for (const id of ['stat-colors','stat-regions','stat-vertices','stat-size','output-size','timing']) $(id).textContent = '—';
  setBusy(false);
}
function cancel() {
  if (conversionTimer !== undefined) window.clearTimeout(conversionTimer);
  conversionTimer = undefined; job++; worker?.terminate(); worker = undefined; setBusy(false);
}
function fail(message: string) { status.textContent = message; status.classList.add('error'); setBusy(false); }
function renderSource(image: RasterImage) {
  source = image; canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  preview.setSize(image.width, image.height);
  $('input-size').textContent = `${image.width} × ${image.height}`;
}
function download(svg: string, name: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function convert() {
  if (conversionTimer !== undefined) window.clearTimeout(conversionTimer);
  conversionTimer = undefined;
  if (!source || !controls.reportValidity()) return;
  cancel(); clearResult(); status.classList.remove('error');
  const paletteText = $<HTMLTextAreaElement>('palette-input').value.trim();
  const options = { removeBackground: $<HTMLInputElement>('remove-background').checked, colors: +$<HTMLInputElement>('colors').value, curveTolerance: +$<HTMLInputElement>('curve-tolerance').value, widthMm: +$<HTMLInputElement>('width').value, minRegionPixels: +$<HTMLInputElement>('regions').value, minRegionAreaMm2: +$<HTMLInputElement>('area').value, maxDimension: +$<HTMLSelectElement>('resolution').value, ...(paletteText ? { palette: paletteText.split(',').map(c=>c.trim()) } : {}) };
  const current = ++job;
  worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<Response>) => {
    if (data.id !== job) return;
    worker?.terminate(); worker = undefined;
    if ('error' in data) { fail(data.error); return; }
    result = data.result;
    svgUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
    preview.setResult(svgUrl);
    $('output-size').textContent = `${result.widthMm} × ${result.heightMm.toFixed(1)} mm`;
    $('timing').textContent = `${Math.round(data.elapsedMs)} ms`;
    $('stat-colors').textContent = `${result.stats.colors}`;
    $('stat-regions').textContent = result.stats.regions.toLocaleString('en-US');
    $('stat-vertices').textContent = result.stats.pathSegments.toLocaleString('en-US');
    $('stat-size').textContent = `${(new Blob([result.svg]).size/1024).toFixed(1)} KB`;
    $('palette').replaceChildren(...result.layers.map(layer => {
      const swatch = document.createElement('div'); swatch.className = 'swatch';
      const chip = document.createElement('span'); chip.style.backgroundColor = layer.color; chip.className = 'chip';
      const text = document.createElement('span'); text.textContent = layer.color.toUpperCase();
      const area = document.createElement('small'); area.textContent = `${(layer.pixels/result!.stats.opaquePixels*100).toFixed(1)}%`;
      swatch.append(chip, text, area); return swatch;
    }));
    $('warnings').textContent = result.warnings.join(' '); $('warnings').hidden = !result.warnings.length;
    status.textContent = `Complete · ${result.stats.mergedRegions.toLocaleString('en-US')} small regions merged · ${result.stats.curveSegments.toLocaleString('en-US')} curves${result.stats.removedBackgroundPixels ? ` · ${result.stats.removedBackgroundPixels.toLocaleString('en-US')} background pixels removed` : ''}`;
    settingsDirty = false;
    setBusy(false);
  };
  worker.onerror = event => { if (current !== job) return; worker?.terminate(); worker = undefined; fail(`Conversion failed: ${event.message}`); };
  const data = new Uint8Array(source.data);
  const request: Request = { id: current, image: { width: source.width, height: source.height, data }, options };
  setBusy(true); status.textContent = 'Reducing colors and tracing paths…';
  worker.postMessage(request, [data.buffer]);
}
function scheduleConversion() {
  $('color-value').textContent = `${$<HTMLInputElement>('colors').value} COLORS`;
  $('curve-value').textContent = `${$<HTMLInputElement>('curve-tolerance').value} px`;
  settingsDirty = true;
  if (conversionTimer !== undefined) window.clearTimeout(conversionTimer);
  job++; worker?.terminate(); worker = undefined; setBusy(false);
  status.classList.remove('error');
  if (!source || !controls.checkValidity()) {
    status.textContent = 'Enter valid settings to update the preview.';
    return;
  }
  status.textContent = 'Updating preview…';
  conversionTimer = window.setTimeout(() => {
    conversionTimer = undefined;
    convert();
  }, 180);
}
async function openFile(file: File) {
  const current = ++loadId; cancel(); clearResult(); status.classList.remove('error');
  try {
    if (file.size > 30*1024*1024) throw new Error('Choose an image no larger than 30MB.');
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('Choose a PNG, JPG, WebP, GIF or BMP image.');
    status.textContent = 'Reading image…';
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (current !== loadId) { bitmap.close(); return; }
    try {
      if (bitmap.width*bitmap.height > 40_000_000) throw new Error('Choose an image no larger than 40 megapixels.');
      const temporary = document.createElement('canvas'); temporary.width = bitmap.width; temporary.height = bitmap.height;
      const context = temporary.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0);
      renderSource(context.getImageData(0, 0, bitmap.width, bitmap.height));
      outputName = file.name.replace(/\.[^.]+$/, ''); $('filename').textContent = file.name;
    } finally { bitmap.close(); }
    convert();
  } catch (error) { if (current === loadId) fail(error instanceof Error ? error.message : String(error)); }
}
function sample() {
  ++loadId; cancel(); clearResult(); outputName = 'landscape';
  const c = document.createElement('canvas'); c.width = 720; c.height = 720;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f1dfb8'; ctx.fillRect(0,0,720,720);
  ctx.fillStyle = '#dc7248'; ctx.beginPath(); ctx.arc(487,220,105,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#9caea0'; ctx.beginPath(); ctx.moveTo(0,416); ctx.lineTo(230,180); ctx.lineTo(520,520); ctx.lineTo(720,340); ctx.lineTo(720,720); ctx.lineTo(0,720); ctx.fill();
  ctx.fillStyle = '#42695b'; ctx.beginPath(); ctx.moveTo(0,540); ctx.bezierCurveTo(220,260,365,655,720,425); ctx.lineTo(720,720); ctx.lineTo(0,720); ctx.fill();
  ctx.fillStyle = '#183f3b'; ctx.beginPath(); ctx.moveTo(0,618); ctx.bezierCurveTo(200,400,390,785,720,540); ctx.lineTo(720,720); ctx.lineTo(0,720); ctx.fill();
  ctx.strokeStyle = '#f1dfb8'; ctx.lineWidth = 19; ctx.beginPath(); ctx.moveTo(470,760); ctx.bezierCurveTo(200,592,610,616,495,496); ctx.stroke();
  renderSource(ctx.getImageData(0,0,720,720)); $('filename').textContent = 'Sample: Landscape study'; convert();
}
controls.addEventListener('submit', event => { event.preventDefault(); convert(); });
controls.addEventListener('input', scheduleConversion);
$('sample').addEventListener('click', sample);
$('cancel').addEventListener('click', ()=>{ cancel(); clearResult(); status.textContent = 'Conversion canceled.'; });
$('download').addEventListener('click', ()=>{ if(result) download(result.svg, `${outputName}.svg`); });
$<HTMLInputElement>('file').addEventListener('change', event=>{ const input = event.target as HTMLInputElement; const file = input.files?.[0]; if(file) void openFile(file); input.value = ''; });
for (const type of ['dragenter','dragover']) $('drop').addEventListener(type, event=>{ event.preventDefault(); $('drop').classList.add('dragging'); });
$('drop').addEventListener('dragleave', ()=>$('drop').classList.remove('dragging'));
$('drop').addEventListener('drop', event=>{ event.preventDefault(); $('drop').classList.remove('dragging'); const file = (event as DragEvent).dataTransfer?.files[0]; if(file) void openFile(file); });
window.addEventListener('beforeunload', ()=>{ if (conversionTimer !== undefined) window.clearTimeout(conversionTimer); preview.destroy(); worker?.terminate(); if(svgUrl) URL.revokeObjectURL(svgUrl); });
sample();
