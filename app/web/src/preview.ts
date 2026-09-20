import './preview.css';

type Mode = 'original' | 'svg' | 'split';
export const previewMarkup = `
<div class="comparison">
  <div class="preview-toolbar">
    <div class="preview-modes" role="group" aria-label="Preview mode">
      <button type="button" data-mode="original" aria-pressed="false">Original</button>
      <button type="button" data-mode="svg" aria-pressed="false">SVG</button>
      <button type="button" data-mode="split" aria-pressed="true">Split</button>
    </div>
    <div class="zoom-controls" role="group" aria-label="Zoom controls">
      <button type="button" id="zoom-out" aria-label="Zoom out">−</button><output id="zoom-value" aria-label="Zoom relative to fit">100%</output><button type="button" id="zoom-in" aria-label="Zoom in">＋</button>
      <button type="button" id="zoom-reset">Reset zoom</button>
    </div>
  </div>
  <div class="comparison-stage" id="result-preview" data-mode="split" aria-busy="false" tabindex="0" aria-label="Image comparison" aria-describedby="preview-help">
    <div class="comparison-pane source-pane checker"><canvas id="original" class="preview-media" aria-label="Original image"></canvas><span class="pane-badge">Original</span></div>
    <div class="comparison-pane svg-pane checker"><img id="result-image" class="preview-media" alt="SVG result with separated colors" draggable="false" hidden><div id="placeholder">Your SVG preview will appear here.</div><span class="pane-badge">SVG</span></div>
    <div id="split-divider" class="split-divider" role="slider" tabindex="0" aria-label="Split position" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span aria-hidden="true">‹ ›</span></div>
  </div>
  <div class="preview-meta"><span>Original <b id="input-size">—</b></span><span>SVG <b id="output-size">—</b></span></div>
  <p id="preview-help" class="preview-help">Scroll to zoom · drag to pan · move the divider to compare <span>Keyboard: + / − to zoom, arrows to pan, 0 to reset</span></p>
</div>`;

/** One camera for both surfaces; split position stays in viewport coordinates. */
export function createPreview(root: HTMLElement) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const stage = get('result-preview'), divider = get('split-divider');
  const image = get<HTMLImageElement>('result-image'), placeholder = get('placeholder');
  const modes = [...root.querySelectorAll<HTMLButtonElement>('[data-mode]')].filter(el => el.tagName === 'BUTTON');
  let width = 1, height = 1, zoom = 1, panX = 0, panY = 0, split = 50, mode: Mode = 'split';
  const pointers = new Map<number, { x: number; y: number }>();
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  function render() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const fit = Math.min(w / width, h / height);
    const mediaW = width * fit * zoom, mediaH = height * fit * zoom;
    panX = clamp(panX, -(w + mediaW) / 2 + 32, (w + mediaW) / 2 - 32);
    panY = clamp(panY, -(h + mediaH) / 2 + 32, (h + mediaH) / 2 - 32);
    // Give SVG a real rendered size so high zoom remains vector-sharp.
    stage.style.setProperty('--media-width', `${mediaW}px`);
    stage.style.setProperty('--media-height', `${mediaH}px`);
    stage.style.setProperty('--media-left', `${(w - mediaW) / 2 + panX}px`);
    stage.style.setProperty('--media-top', `${(h - mediaH) / 2 + panY}px`);
    stage.style.setProperty('--split', `${split}%`);
    get('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    get<HTMLButtonElement>('zoom-out').disabled = zoom <= 0.25;
    get<HTMLButtonElement>('zoom-in').disabled = zoom >= 32;
    divider.setAttribute('aria-valuenow', String(Math.round(split)));
    divider.setAttribute('aria-valuetext', `Original ${Math.round(split)}%, SVG ${100 - Math.round(split)}%`);
  }
  function zoomAt(next: number, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
    next = clamp(next, 0.25, 32);
    const ratio = next / zoom, dx = x - stage.clientWidth / 2, dy = y - stage.clientHeight / 2;
    panX = dx - (dx - panX) * ratio; panY = dy - (dy - panY) * ratio;
    zoom = next;
  }
  function reset() { zoom = 1; panX = panY = 0; render(); }
  function setMode(next: Mode) {
    mode = next; stage.dataset.mode = mode;
    for (const button of modes) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    divider.hidden = mode !== 'split';
  }
  for (const button of modes) button.addEventListener('click', () => setMode(button.dataset.mode as Mode));
  get('zoom-in').addEventListener('click', () => { zoomAt(zoom * 1.25); render(); });
  get('zoom-out').addEventListener('click', () => { zoomAt(zoom / 1.25); render(); });
  get('zoom-reset').addEventListener('click', reset);
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
    zoomAt(zoom * Math.exp(-clamp(delta, -500, 500) * 0.002), event.clientX - rect.left, event.clientY - rect.top); render();
  }, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target === divider || divider.contains(event.target as Node)) return;
    event.preventDefault(); stage.focus({ preventScroll: true }); stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', event => {
    const before = pointers.get(event.pointerId); if (!before) return;
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
      const newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const rect = stage.getBoundingClientRect();
      if (oldDistance > 0) zoomAt(zoom * newDistance / oldDistance, (before.x + other.x) / 2 - rect.left, (before.y + other.y) / 2 - rect.top);
      panX += (event.clientX - before.x) / 2; panY += (event.clientY - before.y) / 2;
    } else { panX += event.clientX - before.x; panY += event.clientY - before.y; }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); render();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, event => {
    pointers.delete((event as PointerEvent).pointerId); if (!pointers.size) stage.classList.remove('panning');
  });
  stage.addEventListener('keydown', event => {
    if (event.target !== stage) return;
    switch (event.key) {
      case '+': case '=': zoomAt(zoom * 1.25); break;
      case '-': zoomAt(zoom / 1.25); break;
      case '0': case 'Home': reset(); break;
      case 'ArrowLeft': panX -= 32; break;
      case 'ArrowRight': panX += 32; break;
      case 'ArrowUp': panY -= 32; break;
      case 'ArrowDown': panY += 32; break;
      default: return;
    }
    event.preventDefault(); render();
  });
  function moveDivider(clientX: number) {
    const rect = stage.getBoundingClientRect(); split = clamp((clientX - rect.left) / rect.width * 100, 0, 100); render();
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId); moveDivider(event.clientX);
  });
  divider.addEventListener('pointermove', event => { if (divider.hasPointerCapture(event.pointerId)) moveDivider(event.clientX); });
  divider.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': split -= step; break;
      case 'ArrowRight': case 'ArrowUp': split += step; break;
      case 'Home': split = 0; break;
      case 'End': split = 100; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); split = clamp(split, 0, 100); render();
  });
  const observer = new ResizeObserver(render); observer.observe(stage); render();
  return {
    setSize(w: number, h: number) { width = w; height = h; reset(); },
    setResult(url: string | null) {
      if (url) image.src = url; else image.removeAttribute('src');
      image.hidden = !url; placeholder.hidden = !!url;
    },
    destroy() { observer.disconnect(); },
  };
}
