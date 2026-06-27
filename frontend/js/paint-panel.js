/**
 * Paint panel UI – wires DOM controls to TexturePainter.
 * Brush controls, channel tabs, layer stack, export.
 */

import { CHANNELS, BLEND_MODES } from './texture-painter.js';

// SVG icons for each brush type (compact path-only SVGs)
const BRUSH_ICONS = {
  round_soft:  `<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="currentColor" opacity=".5"/>`,
  round_hard:  `<circle cx="12" cy="12" r="8" fill="currentColor"/>`,
  square:      `<rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor"/>`,
  spray:       `<circle cx="7" cy="7" r="1.5" fill="currentColor"/><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="17" cy="8" r="1.5" fill="currentColor"/><circle cx="6" cy="13" r="1.5" fill="currentColor"/><circle cx="11" cy="12" r="1.5" fill="currentColor"/><circle cx="16" cy="14" r="1.5" fill="currentColor"/><circle cx="9" cy="17" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>`,
  smear:       `<path d="M4 12 Q8 6 12 12 Q16 18 20 12" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 14 Q8 8 12 14 Q16 20 20 14" stroke="currentColor" stroke-width="1" fill="none" opacity=".4"/>`,
  grunge:      `<path d="M8 8 Q9 7 10 9 Q11 8 12 10 Q14 7 15 11 Q16 9 17 12 Q14 14 12 13 Q10 15 8 13 Q6 14 7 11 Q6 9 8 8Z" fill="currentColor" opacity=".8"/>`,
  blob:        `<path d="M12 4 Q17 5 19 10 Q21 15 16 18 Q11 21 7 17 Q3 13 5 8 Q7 3 12 4Z" fill="currentColor"/>`,
  hatching:    `<line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="9" x2="15" y2="19" stroke="currentColor" stroke-width="1.5"/><line x1="9" y1="5" x2="19" y2="15" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="13" x2="11" y2="19" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="5" x2="19" y2="11" stroke="currentColor" stroke-width="1.5"/>`,
  dots:        `<circle cx="7" cy="7" r="2" fill="currentColor"/><circle cx="12" cy="7" r="2" fill="currentColor"/><circle cx="17" cy="7" r="2" fill="currentColor"/><circle cx="7" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="17" cy="12" r="2" fill="currentColor"/><circle cx="7" cy="17" r="2" fill="currentColor"/><circle cx="12" cy="17" r="2" fill="currentColor"/><circle cx="17" cy="17" r="2" fill="currentColor"/>`,
  erase:       `<rect x="5" y="10" width="14" height="7" rx="1" fill="currentColor"/><path d="M9 10 L15 10 L12 5Z" fill="currentColor"/>`,
};

const BRUSH_LABELS = {
  round_soft: 'Soft',    round_hard: 'Hard',    square:  'Square',
  spray:      'Spray',   smear:      'Smear',   grunge:  'Grunge',
  blob:       'Blob',    hatching:   'Hatch',   dots:    'Dots',
  erase:      'Erase',
};

let _painter  = null;
let _active   = false;
let _cursorEl = null;

// ── Init ─────────────────────────────────────────────────────────────────────

export function initPaintPanel(painter) {
  _painter = painter;

  // Cursor overlay
  _cursorEl = document.createElement('div');
  _cursorEl.id = 'paint-cursor';
  document.body.appendChild(_cursorEl);

  _buildBrushTypeGrid();
  _bindControls();

  painter.onChange = (event, ch) => {
    if (event === 'layersChanged') _renderLayerList(ch ?? painter.brush.channel);
    if (event === 'strokeEnd')     _renderLayerList(painter.brush.channel);
    if (event === 'undo')          { _renderLayerList(painter.brush.channel); _syncUndoBtn(); }
    if (event === 'cursorMove')    _moveCursor(ch);   // ch is the event here
  };
}

// ── Open / Close ─────────────────────────────────────────────────────────────

export function openPaintPanel(itemId, meshGroup) {
  if (!_painter) return;

  const ok = _painter.activate(itemId, meshGroup);
  if (!ok) { alert('No paintable geometry found on this object.'); return; }

  _active = true;
  document.getElementById('paint-panel').style.display = 'flex';
  document.getElementById('three-canvas').style.cursor = 'none';
  _cursorEl.style.display = 'block';

  // Show the active channel tab
  _switchChannel(_painter.brush.channel);
  _syncUndoBtn();
}

export function closePaintPanel() {
  if (!_painter) return;
  _painter.deactivate();
  _active = false;
  document.getElementById('paint-panel').style.display = 'none';
  document.getElementById('three-canvas').style.cursor = '';
  _cursorEl.style.display = 'none';
  document.getElementById('vp-btn-paint').classList.remove('active');
}

export function isPaintActive() { return _active; }

// ── Cursor overlay ────────────────────────────────────────────────────────────

function _moveCursor(e) {
  if (!_active || !e || !e.clientX) return;
  const r = _painter.brush.size / 2;
  _cursorEl.style.width  = `${r * 2}px`;
  _cursorEl.style.height = `${r * 2}px`;
  _cursorEl.style.left   = `${e.clientX - r}px`;
  _cursorEl.style.top    = `${e.clientY - r}px`;
}

// ── Channel switching ─────────────────────────────────────────────────────────

function _switchChannel(ch) {
  _painter.brush.channel = ch;

  // Update tab active state
  document.querySelectorAll('.paint-ch-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.ch === ch),
  );

  // Color vs greyscale picker visibility
  const isColor = CHANNELS[ch].isColor;
  document.getElementById('paint-color-row').style.display    = isColor ? 'flex' : 'none';
  document.getElementById('paint-value-row').style.display    = isColor ? 'none' : 'flex';
  document.getElementById('paint-hs-row').style.display       = ch === 'height' ? 'flex' : 'none';

  _renderLayerList(ch);
}

// ── Build brush-type grid ─────────────────────────────────────────────────────

function _buildBrushTypeGrid() {
  const grid = document.getElementById('paint-brush-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const [type, svgBody] of Object.entries(BRUSH_ICONS)) {
    const btn = document.createElement('button');
    btn.className   = 'brush-type-btn' + (type === _painter.brush.type ? ' active' : '');
    btn.dataset.type = type;
    btn.title       = BRUSH_LABELS[type];
    btn.innerHTML   = `<svg viewBox="0 0 24 24" width="18" height="18">${svgBody}</svg><span>${BRUSH_LABELS[type]}</span>`;
    btn.addEventListener('click', () => {
      _painter.brush.type = type;
      document.querySelectorAll('.brush-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    grid.appendChild(btn);
  }
}

// ── Slider helper ─────────────────────────────────────────────────────────────

function _slider(id, prop, displayFn) {
  const el  = document.getElementById(id);
  const lbl = document.getElementById(`${id}-val`);
  if (!el) return;
  el.value = _painter.brush[prop];
  if (lbl) lbl.textContent = displayFn ? displayFn(_painter.brush[prop]) : _painter.brush[prop];
  el.addEventListener('input', () => {
    _painter.brush[prop] = parseFloat(el.value);
    if (lbl) lbl.textContent = displayFn ? displayFn(_painter.brush[prop]) : _painter.brush[prop];
    _updateCursorSize();
  });
}

function _pct(v)   { return `${Math.round(v * 100)}%`; }
function _fixed(v) { return v.toFixed(1); }

function _updateCursorSize() {
  const r = _painter.brush.size / 2;
  _cursorEl.style.width  = `${r * 2}px`;
  _cursorEl.style.height = `${r * 2}px`;
}

// ── Bind all controls ─────────────────────────────────────────────────────────

function _bindControls() {
  // Channel tabs
  document.querySelectorAll('.paint-ch-tab').forEach(tab =>
    tab.addEventListener('click', () => _switchChannel(tab.dataset.ch)),
  );

  // Color picker
  const colorPicker = document.getElementById('paint-color');
  if (colorPicker) {
    colorPicker.value = _painter.brush.color;
    colorPicker.addEventListener('input', () => { _painter.brush.color = colorPicker.value; });
  }

  // Greyscale value slider
  const valSlider = document.getElementById('paint-value');
  const valLbl    = document.getElementById('paint-value-val');
  if (valSlider) {
    valSlider.addEventListener('input', () => {
      _painter.brush.value = parseFloat(valSlider.value);
      if (valLbl) valLbl.textContent = _pct(_painter.brush.value);
    });
  }

  // Brush sliders
  _slider('paint-size',     'size',    v => `${Math.round(v)}px`);
  _slider('paint-opacity',  'opacity', _pct);
  _slider('paint-hardness', 'hardness',_pct);
  _slider('paint-flow',     'flow',    _pct);
  _slider('paint-spacing',  'spacing', _pct);

  // Height strength
  const hsEl  = document.getElementById('paint-hs');
  const hsLbl = document.getElementById('paint-hs-val');
  if (hsEl) {
    hsEl.value = _painter.brush.heightStrength;
    hsEl.addEventListener('input', () => {
      _painter.brush.heightStrength = parseFloat(hsEl.value);
      if (hsLbl) hsLbl.textContent = _fixed(_painter.brush.heightStrength);
    });
  }

  // Undo
  document.getElementById('btn-paint-undo')?.addEventListener('click', () => {
    _painter.undo();
    _syncUndoBtn();
  });

  // Close
  document.getElementById('btn-paint-close')?.addEventListener('click', closePaintPanel);

  // Add layer
  document.getElementById('btn-paint-add-layer')?.addEventListener('click', () => {
    _painter.addLayer(_painter.brush.channel, `Layer ${_painter.getLayers(_painter.brush.channel).length + 1}`);
    _renderLayerList(_painter.brush.channel);
  });

  // Fill layer
  document.getElementById('btn-paint-fill')?.addEventListener('click', () => {
    const ch      = _painter.brush.channel;
    const isColor = CHANNELS[ch].isColor;
    const col     = isColor ? _painter.brush.color : _painter._greyHex(_painter.brush.value);
    _painter.fillLayer(ch, col);
  });

  // Export
  document.getElementById('btn-paint-export')?.addEventListener('click', _doExport);
}

function _syncUndoBtn() {
  const btn = document.getElementById('btn-paint-undo');
  if (btn) btn.disabled = !_painter?.canUndo;
}

// ── Layer list ────────────────────────────────────────────────────────────────

function _renderLayerList(ch) {
  const list = document.getElementById('paint-layers-list');
  if (!list || !_painter) return;
  const layers   = _painter.getLayers(ch);
  const activeI  = _painter._activeIdx[ch] ?? 0;
  list.innerHTML = '';

  // Render layers top-to-bottom (reverse order = topmost first)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const row   = document.createElement('div');
    row.className = 'paint-layer-row' + (i === activeI ? ' active' : '');
    row.addEventListener('click', () => {
      _painter.setActiveLayer(ch, i);
      _renderLayerList(ch);
    });

    // Visibility eye
    const eye = document.createElement('button');
    eye.className = 'layer-eye' + (layer.visible ? ' on' : '');
    eye.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>${layer.visible ? '' : '<line x1="3" y1="3" x2="21" y2="21"/>'}</svg>`;
    eye.addEventListener('click', ev => {
      ev.stopPropagation();
      _painter.updateLayer(ch, i, { visible: !layer.visible });
      _renderLayerList(ch);
    });

    // Thumbnail (scaled-down preview)
    const thumb      = document.createElement('canvas');
    thumb.width      = thumb.height = 28;
    thumb.className  = 'layer-thumb';
    thumb.getContext('2d').drawImage(layer.canvas, 0, 0, 28, 28);

    // Name (editable)
    const name      = document.createElement('span');
    name.className  = 'layer-name';
    name.textContent = layer.name;
    name.contentEditable = 'true';
    name.addEventListener('blur', () => _painter.updateLayer(ch, i, { name: name.textContent }));
    name.addEventListener('click', ev => ev.stopPropagation());

    // Blend mode
    const blendSel  = document.createElement('select');
    blendSel.className = 'layer-blend';
    BLEND_MODES.forEach(m => {
      const opt   = document.createElement('option');
      opt.value   = m;
      opt.textContent = m;
      if (m === layer.blendMode) opt.selected = true;
      blendSel.appendChild(opt);
    });
    blendSel.addEventListener('change', ev => {
      ev.stopPropagation();
      _painter.updateLayer(ch, i, { blendMode: blendSel.value });
    });
    blendSel.addEventListener('click', ev => ev.stopPropagation());

    // Opacity
    const opSl   = document.createElement('input');
    opSl.type    = 'range'; opSl.min = '0'; opSl.max = '1'; opSl.step = '0.01';
    opSl.value   = layer.opacity;
    opSl.className = 'layer-opacity-sl';
    opSl.addEventListener('input', ev => {
      ev.stopPropagation();
      _painter.updateLayer(ch, i, { opacity: parseFloat(opSl.value) });
    });
    opSl.addEventListener('click', ev => ev.stopPropagation());

    // Delete
    const del       = document.createElement('button');
    del.className   = 'layer-del';
    del.textContent = '×';
    del.title       = 'Delete layer';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      _painter.removeLayer(ch, i);
      _renderLayerList(ch);
    });

    row.append(eye, thumb, name, blendSel, opSl, del);
    list.appendChild(row);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

function _doExport() {
  if (!_painter) return;
  const maps = _painter.exportAll();
  for (const [ch, dataUrl] of Object.entries(maps)) {
    if (!dataUrl) continue;
    const a    = document.createElement('a');
    a.href     = dataUrl;
    a.download = `texture_${ch}.png`;
    a.click();
  }
}
