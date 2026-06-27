/**
 * Material Library panel – swatches, category tabs, drag-to-apply, click-to-apply.
 * Drag a swatch onto the 3D viewport to apply to the mesh under the cursor.
 * Click a swatch to apply to the currently selected object.
 */

import { getByCategory, drawSwatch, importTextureSet, removeImported, CATEGORIES } from './material-library.js';

let _applyFn   = null;
let _dragMat   = null;
let _dragGhost = null;
let _activeCat = 'All';

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMaterialPanel(applyFn) {
  _applyFn = applyFn;

  _buildCategoryTabs();
  _renderGrid();

  document.getElementById('btn-mat-import')?.addEventListener('click', async () => {
    const mat = await importTextureSet();
    if (mat) { _activeCat = 'Imported'; _buildCategoryTabs(); _renderGrid(); }
  });

  document.getElementById('btn-mat-close')?.addEventListener('click', closeMaterialPanel);

  document.addEventListener('mousemove', _onDragMove);
  document.addEventListener('mouseup',   _onDragUp);
}

// ── Open / Close ──────────────────────────────────────────────────────────────

export function openMaterialPanel() {
  const p = document.getElementById('mat-panel');
  if (p) p.style.display = 'flex';
  document.getElementById('vp-btn-mat')?.classList.add('active');
}

export function closeMaterialPanel() {
  const p = document.getElementById('mat-panel');
  if (p) p.style.display = 'none';
  document.getElementById('vp-btn-mat')?.classList.remove('active');
  _cancelDrag();
}

export function isMaterialPanelOpen() {
  const p = document.getElementById('mat-panel');
  return !!p && p.style.display !== 'none';
}

// ── Category tabs ─────────────────────────────────────────────────────────────

function _buildCategoryTabs() {
  const bar = document.getElementById('mat-cat-bar');
  if (!bar) return;
  bar.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className   = 'mat-cat-tab' + (cat === _activeCat ? ' active' : '');
    btn.textContent = cat;
    btn.dataset.cat = cat;
    btn.addEventListener('click', () => {
      _activeCat = cat;
      bar.querySelectorAll('.mat-cat-tab').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
      _renderGrid();
    });
    bar.appendChild(btn);
  });
}

// ── Swatch grid ───────────────────────────────────────────────────────────────

function _renderGrid() {
  const grid = document.getElementById('mat-grid');
  if (!grid) return;
  grid.innerHTML = '';

  getByCategory(_activeCat).forEach(mat => {
    const cell = document.createElement('div');
    cell.className = 'mat-swatch';
    cell.title     = `${mat.name}  ·  ${mat.category}\nDrag onto mesh  –or–  click to apply to selected`;

    const preview  = document.createElement('canvas');
    preview.width  = preview.height = 60;
    preview.className = 'mat-swatch-canvas';
    drawSwatch(preview, mat);

    const label     = document.createElement('span');
    label.className = 'mat-swatch-label';
    label.textContent = mat.name;

    cell.appendChild(preview);
    cell.appendChild(label);

    // Click → apply to current selection
    cell.addEventListener('click', () => _applyFn?.(mat, null));

    // Drag → drag-to-apply on dropped mesh
    cell.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _startDrag(e, mat);
      e.preventDefault();
    });

    if (mat.category === 'Imported') {
      const del     = document.createElement('button');
      del.className = 'mat-swatch-del';
      del.textContent = '×';
      del.title     = 'Remove material';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        removeImported(mat.id);
        _renderGrid();
      });
      cell.appendChild(del);
    }

    grid.appendChild(cell);
  });
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function _startDrag(e, mat) {
  _dragMat = mat;

  _dragGhost = document.createElement('div');
  _dragGhost.className = 'mat-drag-ghost';

  const c = document.createElement('canvas');
  c.width = c.height = 40;
  drawSwatch(c, mat);
  _dragGhost.appendChild(c);

  const lbl = document.createElement('span');
  lbl.textContent = mat.name;
  _dragGhost.appendChild(lbl);

  document.body.appendChild(_dragGhost);
  _moveGhost(e.clientX, e.clientY);
}

function _moveGhost(x, y) {
  if (!_dragGhost) return;
  _dragGhost.style.left = `${x + 14}px`;
  _dragGhost.style.top  = `${y + 14}px`;
}

function _onDragMove(e) {
  if (!_dragGhost) return;
  _moveGhost(e.clientX, e.clientY);

  const vp = document.getElementById('three-canvas');
  if (vp) {
    const r  = vp.getBoundingClientRect();
    const on = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    vp.classList.toggle('mat-drop-hover', on);
  }
}

function _onDragUp(e) {
  if (!_dragMat) return;
  const mat = _dragMat;
  _cancelDrag();

  const vp = document.getElementById('three-canvas');
  if (!vp) return;
  const r  = vp.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
    _applyFn?.(mat, { clientX: e.clientX, clientY: e.clientY });
  }
}

function _cancelDrag() {
  _dragGhost?.remove();
  _dragGhost = null;
  _dragMat   = null;
  document.getElementById('three-canvas')?.classList.remove('mat-drop-hover');
}
