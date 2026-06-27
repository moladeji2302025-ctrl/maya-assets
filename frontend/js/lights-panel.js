import { LIGHT_TYPES } from './lights-manager.js';
import { attachLightGizmo, detachLightGizmo } from './viewer.js';

// Property schema for each light type
const PROPS = {
  ambient: [
    { key: 'color',     label: 'Color',     type: 'color' },
    { key: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 5, step: 0.01 },
  ],
  directional: [
    { key: 'color',      label: 'Color',        type: 'color' },
    { key: 'intensity',  label: 'Intensity',    type: 'range', min: 0, max: 5,   step: 0.01 },
    { key: 'x',         label: 'Position X',    type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'y',         label: 'Position Y',    type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'z',         label: 'Position Z',    type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'targetX',   label: 'Target X',      type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'targetY',   label: 'Target Y',      type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'targetZ',   label: 'Target Z',      type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'castShadow',label: 'Cast Shadows',  type: 'bool' },
  ],
  point: [
    { key: 'color',    label: 'Color',     type: 'color' },
    { key: 'intensity',label: 'Intensity', type: 'range', min: 0, max: 10,  step: 0.01 },
    { key: 'x',       label: 'Position X', type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'y',       label: 'Position Y', type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'z',       label: 'Position Z', type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'distance',label: 'Range (0=∞)',type: 'range', min: 0, max: 500, step: 1 },
    { key: 'decay',   label: 'Decay',      type: 'range', min: 0, max: 5,   step: 0.01 },
  ],
  spot: [
    { key: 'color',      label: 'Color',        type: 'color' },
    { key: 'intensity',  label: 'Intensity',    type: 'range', min: 0, max: 10,  step: 0.01 },
    { key: 'x',         label: 'Position X',    type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'y',         label: 'Position Y',    type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'z',         label: 'Position Z',    type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'targetX',   label: 'Target X',      type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'targetY',   label: 'Target Y',      type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'targetZ',   label: 'Target Z',      type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'angle',     label: 'Cone Angle (°)',type: 'range', min: 1, max: 90,  step: 0.5 },
    { key: 'penumbra',  label: 'Penumbra',      type: 'range', min: 0, max: 1,   step: 0.01 },
    { key: 'distance',  label: 'Range (0=∞)',   type: 'range', min: 0, max: 500, step: 1 },
    { key: 'decay',     label: 'Decay',         type: 'range', min: 0, max: 5,   step: 0.01 },
    { key: 'castShadow',label: 'Cast Shadows',  type: 'bool' },
  ],
  hemisphere: [
    { key: 'skyColor',   label: 'Sky Color',    type: 'color' },
    { key: 'groundColor',label: 'Ground Color', type: 'color' },
    { key: 'intensity',  label: 'Intensity',    type: 'range', min: 0, max: 3, step: 0.01 },
  ],
  rectarea: [
    { key: 'color',    label: 'Color',      type: 'color' },
    { key: 'intensity',label: 'Intensity',  type: 'range', min: 0, max: 20, step: 0.1 },
    { key: 'x',       label: 'Position X',  type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'y',       label: 'Position Y',  type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'z',       label: 'Position Z',  type: 'range', min: -100, max: 100, step: 0.5 },
    { key: 'rotX',    label: 'Rotation X°', type: 'range', min: -180, max: 180, step: 1 },
    { key: 'rotY',    label: 'Rotation Y°', type: 'range', min: -180, max: 180, step: 1 },
    { key: 'rotZ',    label: 'Rotation Z°', type: 'range', min: -180, max: 180, step: 1 },
    { key: 'width',   label: 'Width',       type: 'range', min: 0.1, max: 50, step: 0.1 },
    { key: 'height',  label: 'Height',      type: 'range', min: 0.1, max: 50, step: 0.1 },
  ],
};

let _lightManager = null;
let _selectedId = null;
let _gizmoMode = 'position'; // 'position' | 'target'

export function initLightsPanel(lightManager) {
  _lightManager = lightManager;

  document.getElementById('btn-add-light').addEventListener('click', () => {
    const type = document.getElementById('light-type-select').value;
    const entry = _lightManager.add(type);
    _selectedId = entry.id;
  });

  document.getElementById('btn-lights-close').addEventListener('click', () => {
    document.getElementById('lights-panel').style.display = 'none';
    document.getElementById('vp-btn-lights').classList.remove('active');
    detachLightGizmo();
    _selectedId = null;
  });

  document.getElementById('btn-lights-helpers').addEventListener('click', () => {
    const btn = document.getElementById('btn-lights-helpers');
    const on = btn.classList.toggle('active');
    _lightManager.setHelpersVisible(on);
  });
  document.getElementById('btn-lights-helpers').classList.add('active');

  _lightManager.addEventListener('change', _render);
  _render();
}

function _render() {
  _renderList();
  _renderProps();
}

function _renderList() {
  const list = document.getElementById('lights-list');
  const entries = _lightManager.entries;

  if (!entries.length) {
    list.innerHTML = '<div class="lights-empty">No lights — click Add to create one.</div>';
    return;
  }

  list.innerHTML = entries.map(e => `
    <div class="light-row ${e.id === _selectedId ? 'selected' : ''}" data-id="${e.id}">
      <span class="light-row-icon">${LIGHT_TYPES[e.type].icon}</span>
      <span class="light-row-label">${e.params.label}</span>
      <span class="light-row-type">${LIGHT_TYPES[e.type].label}</span>
      <button class="light-row-delete" data-id="${e.id}" title="Remove light">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.light-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.classList.contains('light-row-delete')) return;
      _selectedId = parseInt(row.dataset.id);
      _gizmoMode = 'position';
      _render();
    });
  });

  list.querySelectorAll('.light-row-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      if (_selectedId === id) { _selectedId = null; detachLightGizmo(); }
      _lightManager.remove(id);
    });
  });
}

const HAS_TARGET = new Set(['directional', 'spot']);
const POSITION_KEYS = { position: ['x','y','z'], target: ['targetX','targetY','targetZ'] };

function _attachGizmoForEntry(entry) {
  const isTarget = _gizmoMode === 'target' && HAS_TARGET.has(entry.type);
  const obj = isTarget ? entry.light.target : entry.light;

  // Make the helper visible while selected
  if (entry.helper) entry.helper.visible = true;

  attachLightGizmo(
    obj,
    // onChange — live update sliders without triggering full re-render
    () => {
      const keys = POSITION_KEYS[isTarget ? 'target' : 'position'];
      const pos = obj.position;
      const vals = [pos.x, pos.y, pos.z];
      keys.forEach((k, i) => {
        const s = document.querySelector(`.prop-slider[data-key="${k}"]`);
        const n = document.querySelector(`.prop-number[data-key="${k}"]`);
        if (s) s.value = vals[i].toFixed(2);
        if (n) n.value = vals[i].toFixed(2);
      });
      if (entry.helper && typeof entry.helper.update === 'function') entry.helper.update();
    },
    // onDragEnd — commit to manager
    () => {
      const keys = POSITION_KEYS[isTarget ? 'target' : 'position'];
      const pos = obj.position;
      _lightManager.update(entry.id, {
        [keys[0]]: pos.x, [keys[1]]: pos.y, [keys[2]]: pos.z,
      });
    }
  );
}

function _renderProps() {
  const container = document.getElementById('lights-properties');
  if (!_selectedId) { detachLightGizmo(); container.innerHTML = ''; return; }

  const entry = _lightManager.entries.find(e => e.id === _selectedId);
  if (!entry) { detachLightGizmo(); container.innerHTML = ''; return; }

  const schema = PROPS[entry.type] || [];
  const p = entry.params;
  const showGizmoBar = entry.type !== 'ambient' && entry.type !== 'hemisphere';
  const hasTarget = HAS_TARGET.has(entry.type);

  container.innerHTML = `
    <div class="lights-props-header">
      <input class="light-label-input" id="light-label-input" value="${p.label}" />
      ${showGizmoBar ? `
      <div class="gizmo-mode-bar">
        <button class="gizmo-mode-btn ${_gizmoMode === 'position' ? 'active' : ''}" data-mode="position">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 12h.01"/>
          </svg>
          Move Light
        </button>
        ${hasTarget ? `<button class="gizmo-mode-btn ${_gizmoMode === 'target' ? 'active' : ''}" data-mode="target">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          Move Target
        </button>` : ''}
      </div>` : ''}
    </div>
    <div class="lights-props-body">
      ${schema.map(prop => _propHTML(prop, p)).join('')}
    </div>
  `;

  // Label rename
  container.querySelector('#light-label-input').addEventListener('change', e => {
    _lightManager.update(_selectedId, { label: e.target.value });
  });

  // Gizmo mode buttons
  if (showGizmoBar) {
    container.querySelectorAll('.gizmo-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _gizmoMode = btn.dataset.mode;
        _attachGizmoForEntry(entry);
        container.querySelectorAll('.gizmo-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === _gizmoMode));
      });
    });
    _attachGizmoForEntry(entry);
  }

  // Wire up each prop control
  schema.forEach(prop => {
    if (prop.type === 'color') {
      const inp = container.querySelector(`[data-key="${prop.key}"]`);
      inp.addEventListener('input', () => _lightManager.update(_selectedId, { [prop.key]: inp.value }));
    } else if (prop.type === 'range') {
      const slider = container.querySelector(`.prop-slider[data-key="${prop.key}"]`);
      const number = container.querySelector(`.prop-number[data-key="${prop.key}"]`);
      slider.addEventListener('input', () => {
        number.value = slider.value;
        _lightManager.update(_selectedId, { [prop.key]: parseFloat(slider.value) });
      });
      number.addEventListener('change', () => {
        const v = Math.min(prop.max, Math.max(prop.min, parseFloat(number.value) || 0));
        slider.value = v; number.value = v;
        _lightManager.update(_selectedId, { [prop.key]: v });
      });
    } else if (prop.type === 'bool') {
      const cb = container.querySelector(`[data-key="${prop.key}"]`);
      cb.addEventListener('change', () => _lightManager.update(_selectedId, { [prop.key]: cb.checked }));
    }
  });
}

function _propHTML(prop, p) {
  if (prop.type === 'color') {
    return `
      <div class="prop-row">
        <label class="prop-label">${prop.label}</label>
        <input type="color" class="prop-color" data-key="${prop.key}" value="${p[prop.key] || '#ffffff'}">
      </div>`;
  }
  if (prop.type === 'range') {
    const v = p[prop.key] ?? prop.min;
    return `
      <div class="prop-row">
        <label class="prop-label">${prop.label}</label>
        <div class="prop-range-row">
          <input type="range" class="prop-slider" data-key="${prop.key}"
            min="${prop.min}" max="${prop.max}" step="${prop.step}" value="${v}">
          <input type="number" class="prop-number" data-key="${prop.key}"
            min="${prop.min}" max="${prop.max}" step="${prop.step}" value="${v}">
        </div>
      </div>`;
  }
  if (prop.type === 'bool') {
    return `
      <div class="prop-row prop-row-bool">
        <label class="prop-label">${prop.label}</label>
        <input type="checkbox" class="prop-check" data-key="${prop.key}" ${p[prop.key] ? 'checked' : ''}>
      </div>`;
  }
  return '';
}
