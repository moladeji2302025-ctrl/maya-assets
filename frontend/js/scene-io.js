/**
 * Scene I/O – save, load, and export the current scene.
 *
 * Save as file     → downloads .scene.json
 * Load from file   → uploads .scene.json, restores scene
 * Save to library  → POSTs to /api/scenes (SQLite, named)
 * Load from library→ GETs /api/scenes, lets user pick one
 * Export to Maya   → POSTs to /api/scenes/export/maya → downloads .py script
 * Export as GLB    → client-side GLTFExporter → downloads .glb
 */

import { sceneManager }               from './scene-manager.js';
import { placeAsset, clearScene, getScene } from './viewer.js';

const API = 'http://localhost:8000/api';

// ── Save as local file ────────────────────────────────────────────────────────

export function saveSceneFile() {
  const name = prompt('Scene name:', 'My Scene');
  if (name === null) return;

  const data = {
    version:  1,
    name:     name || 'My Scene',
    saved:    new Date().toISOString(),
    ...sceneManager.toJSON(),
  };

  _download(
    JSON.stringify(data, null, 2),
    (data.name.replace(/\s+/g, '_') || 'scene') + '.scene.json',
    'application/json',
  );
}

// ── Load from local file ──────────────────────────────────────────────────────

export function loadSceneFile() {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await _restoreScene(data);
      _status(`Loaded "${data.name || file.name}"`);
    } catch (err) {
      alert(`Failed to load scene: ${err.message}`);
    }
  };
  input.click();
}

// ── Save to server library ────────────────────────────────────────────────────

export async function saveSceneToServer() {
  const name = prompt('Save scene as:', 'My Scene');
  if (name === null) return;

  try {
    const res = await fetch(`${API}/scenes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, layout_json: sceneManager.toJSON() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _status(`Scene saved to library: "${name}"`);
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  }
}

// ── Load from server library ──────────────────────────────────────────────────

export async function loadSceneFromLibrary() {
  let scenes;
  try {
    const res = await fetch(`${API}/scenes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    scenes = await res.json();
  } catch (err) {
    alert(`Could not fetch library: ${err.message}`);
    return;
  }

  if (!scenes.length) { alert('No saved scenes in library yet.'); return; }

  _showLibraryPicker(scenes, async (scene) => {
    try {
      await _restoreScene(scene.layout_json || {});
      _status(`Loaded "${scene.name}" from library`);
    } catch (err) {
      alert(`Load failed: ${err.message}`);
    }
  });
}

// ── Export to Maya ────────────────────────────────────────────────────────────

export async function exportToMaya() {
  const items = sceneManager.items;
  if (!items.length) { alert('Nothing in the scene to export.'); return; }

  const name = prompt('Export name:', 'My Scene');
  if (name === null) return;

  _status('Generating Maya script…');
  try {
    const res = await fetch(`${API}/scenes/export/maya`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ scene: sceneManager.toJSON(), scene_name: name }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob     = await res.blob();
    const cd       = res.headers.get('Content-Disposition') || '';
    const filename = cd.match(/filename="(.+?)"/)?.[1]
                  || (name.replace(/\s+/g, '_') + '_maya.py');
    _downloadBlob(blob, filename);
    _status(`Maya script downloaded: ${filename}`);
  } catch (err) {
    _status('Export failed');
    alert(`Export to Maya failed: ${err.message}`);
  }
}

// ── Export as GLB ─────────────────────────────────────────────────────────────

export async function exportAsGLB() {
  const items = sceneManager.items;
  if (!items.length) { alert('Nothing in the scene to export.'); return; }

  const name = prompt('Export name:', 'My Scene');
  if (name === null) return;

  _status('Building GLB…');
  try {
    const { GLTFExporter }   = await import('three/addons/exporters/GLTFExporter.js');
    const scene              = getScene();
    const exporter           = new GLTFExporter();

    exporter.parse(
      scene,
      (buffer) => {
        _downloadBlob(
          new Blob([buffer], { type: 'model/gltf-binary' }),
          name.replace(/\s+/g, '_') + '.glb',
        );
        _status(`GLB exported: ${name}.glb`);
      },
      (err) => { _status('GLB export failed'); console.error(err); },
      { binary: true, trs: true, onlyVisible: true },
    );
  } catch (err) {
    _status('GLB export failed');
    alert(`GLB export failed: ${err.message}`);
  }
}

// ── Scene restore ─────────────────────────────────────────────────────────────

async function _restoreScene(data) {
  const assets = data.assets || [];
  if (!assets.length) { alert('Scene file contains no assets.'); return; }

  clearScene();
  for (const a of assets) {
    await placeAsset(
      a.asset_id,
      a.display_name,
      a.position  || [0, 0, 0],
      a.rotation  || [0, 0, 0],
      a.scale     ?? 1,
    );
  }
}

// ── Library picker modal ──────────────────────────────────────────────────────

function _showLibraryPicker(scenes, onPick) {
  // Remove any existing picker
  document.getElementById('scene-library-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'scene-library-modal';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Saved Scenes</h2>
        <button class="icon-btn" id="btn-close-library">✕</button>
      </div>
      <div class="modal-body" style="padding:0">
        <ul class="scene-library-list" id="scene-library-list"></ul>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const list = overlay.querySelector('#scene-library-list');
  scenes.forEach(s => {
    const li = document.createElement('li');
    li.className = 'scene-library-item';
    li.innerHTML = `
      <span class="sli-name">${s.name}</span>
      <span class="sli-date">${new Date(s.created_at || Date.now()).toLocaleDateString()}</span>
      <button class="btn-primary btn-sm">Load</button>`;
    li.querySelector('button').addEventListener('click', () => {
      overlay.remove();
      onPick(s);
    });
    list.appendChild(li);
  });

  overlay.querySelector('#btn-close-library').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _download(text, filename, type) {
  _downloadBlob(new Blob([text], { type }), filename);
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function _status(msg) {
  const el = document.getElementById('status-left');
  if (el) el.textContent = msg;
}
