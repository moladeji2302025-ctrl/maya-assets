/**
 * Main application controller – wires together all modules.
 */

import { sceneManager } from './scene-manager.js';
import { clearScene, frameSelection, setTransformMode, setSnapEnabled, separateSelected, lightManager } from './viewer.js';
import { initLightsPanel } from './lights-panel.js';
import { saveSceneFile, loadSceneFile, saveSceneToServer, loadSceneFromLibrary, exportToMaya, exportAsGLB } from './scene-io.js';

const API = 'http://localhost:8000/api';

// ── Mode switching ────────────────────────────────────────────────────────────

const btnManual = document.getElementById('btn-mode-manual');
const btnAI = document.getElementById('btn-mode-ai');
const aiPanel = document.getElementById('ai-panel');

btnManual.addEventListener('click', () => {
  btnManual.classList.add('active');
  btnAI.classList.remove('active');
  aiPanel.style.display = 'flex';
  setStatus('Manual mode');
});

btnAI.addEventListener('click', () => {
  btnAI.classList.add('active');
  btnManual.classList.remove('active');
  aiPanel.style.display = 'flex';
  document.getElementById('chat-input').focus();
  setStatus('AI mode');
});

// ── Viewport toolbar ──────────────────────────────────────────────────────────

const vpBtns = {
  orbit: document.getElementById('vp-btn-orbit'),
  translate: document.getElementById('vp-btn-translate'),
  rotate: document.getElementById('vp-btn-rotate'),
  scale: document.getElementById('vp-btn-scale'),
};

function setVpMode(mode) {
  Object.entries(vpBtns).forEach(([k, btn]) => btn.classList.toggle('active', k === mode));
  setTransformMode(mode === 'orbit' ? null : mode);
}

vpBtns.orbit.addEventListener('click', () => setVpMode('orbit'));
vpBtns.translate.addEventListener('click', () => setVpMode('translate'));
vpBtns.rotate.addEventListener('click', () => setVpMode('rotate'));
vpBtns.scale.addEventListener('click', () => setVpMode('scale'));

document.addEventListener('keydown', e => {
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
  if (e.key === 'g' || e.key === 'G') setVpMode('translate');
  if (e.key === 'r' || e.key === 'R') setVpMode('rotate');
  if (e.key === 's' && !e.metaKey && !e.ctrlKey) setVpMode('scale');
  if (e.key === 'Escape') setVpMode('orbit');
  if (e.key === 'f' || e.key === 'F') frameSelection();
  if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); _doSeparate(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement === document.body) {
      const sel = sceneManager.getSelected();
      if (sel) {
        import('./viewer.js').then(v => v.removeAsset(sel.id));
      }
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); sceneManager.undo(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); sceneManager.redo(); }
});

document.getElementById('vp-btn-frame').addEventListener('click', frameSelection);

let snapEnabled = false;
document.getElementById('vp-btn-snap').addEventListener('click', () => {
  snapEnabled = !snapEnabled;
  document.getElementById('vp-btn-snap').classList.toggle('active', snapEnabled);
  setSnapEnabled(snapEnabled);
});

document.getElementById('vp-btn-clear').addEventListener('click', () => {
  if (confirm('Clear all assets from the scene?')) clearScene();
});

// ── Undo ──────────────────────────────────────────────────────────────────────

const btnUndo = document.getElementById('btn-undo');
btnUndo.addEventListener('click', () => sceneManager.undo());

function syncUndoBtn() {
  btnUndo.disabled = !sceneManager.canUndo;
}
sceneManager.addEventListener('change', syncUndoBtn);
syncUndoBtn();

// ── Modals ────────────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

document.getElementById('btn-settings').addEventListener('click', () => openModal('modal-settings'));
document.getElementById('btn-close-settings').addEventListener('click', () => closeModal('modal-settings'));
document.getElementById('btn-close-detail').addEventListener('click', () => closeModal('modal-asset-detail'));
document.getElementById('btn-close-catalog').addEventListener('click', () => closeModal('modal-catalog'));

document.getElementById('btn-catalog').addEventListener('click', () => openModal('modal-catalog'));

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const key = document.getElementById('setting-api-key').value.trim();
  if (key) localStorage.setItem('anthropic_api_key', key);
  closeModal('modal-settings');
  setStatus('Settings saved');
});

// ── Catalog builder ───────────────────────────────────────────────────────────

document.getElementById('btn-start-catalog').addEventListener('click', async () => {
  const log = document.getElementById('catalog-log');
  const btn = document.getElementById('btn-start-catalog');
  const progressWrap = document.getElementById('catalog-progress-wrap');
  const progressBar = document.getElementById('catalog-progress-bar');

  btn.disabled = true;
  btn.textContent = 'Scanning…';
  log.textContent = '';
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';

  try {
    const res = await fetch(`${API}/catalog/build`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    log.textContent = JSON.stringify(result, null, 2);
    progressBar.style.width = '100%';
    setStatus(`Catalog built: ${result.inserted || 0} assets added`);
  } catch (err) {
    log.textContent = `Error: ${err.message}\n\nThe catalog builder endpoint may not be running.\nStart the backend with: uvicorn main:app --reload`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Scan';
  }
});

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(msg) {
  const el = document.getElementById('status-left');
  if (el) el.textContent = msg;
}

sceneManager.addEventListener('change', () => {
  const right = document.getElementById('status-right');
  if (right) right.textContent = `${sceneManager.count} asset${sceneManager.count !== 1 ? 's' : ''} in scene`;
});

// ── Sidebar collapse ──────────────────────────────────────────────────────────

document.getElementById('btn-sidebar-collapse').addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
});

// ── Separate ──────────────────────────────────────────────────────────────────

function _doSeparate() {
  const count = separateSelected();
  if (count > 1) setStatus(`Separated into ${count} pieces`);
  else if (count === 0) setStatus('Select a set first, or it only has one piece');
}

document.getElementById('btn-separate').addEventListener('click', _doSeparate);

// Update piece count hint whenever selection changes
sceneManager.addEventListener('selectionChange', () => {
  // Dynamically import to avoid circular deps — viewer is already loaded
  import('./viewer.js').then(({ getPieceCount }) => {
    const countEl = document.getElementById('sel-piece-count');
    if (!countEl) return;
    const n = getPieceCount();
    countEl.textContent = n > 1 ? `(${n} pieces)` : '';
    document.getElementById('btn-separate').style.display = n > 1 ? 'inline-block' : 'none';
  });
});

// ── Lights panel ─────────────────────────────────────────────────────────────

initLightsPanel(lightManager);

document.getElementById('vp-btn-lights').addEventListener('click', () => {
  const panel = document.getElementById('lights-panel');
  const btn = document.getElementById('vp-btn-lights');
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'flex' : 'none';
  btn.classList.toggle('active', open);
});

// ── File menu ─────────────────────────────────────────────────────────────────

const fileMenuBtn      = document.getElementById('btn-file-menu');
const fileMenuDropdown = document.getElementById('file-menu-dropdown');

fileMenuBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = fileMenuDropdown.style.display === 'none';
  fileMenuDropdown.style.display = open ? 'flex' : 'none';
  fileMenuBtn.classList.toggle('active', open);
});

document.addEventListener('click', () => {
  fileMenuDropdown.style.display = 'none';
  fileMenuBtn?.classList.remove('active');
});

function _fileAction(id, fn) {
  document.getElementById(id)?.addEventListener('click', () => {
    fileMenuDropdown.style.display = 'none';
    fileMenuBtn?.classList.remove('active');
    fn();
  });
}

_fileAction('fm-save-file',    saveSceneFile);
_fileAction('fm-save-server',  saveSceneToServer);
_fileAction('fm-load-file',    loadSceneFile);
_fileAction('fm-load-server',  loadSceneFromLibrary);
_fileAction('fm-export-maya',  exportToMaya);
_fileAction('fm-export-glb',   exportAsGLB);

// ── Ready ─────────────────────────────────────────────────────────────────────

setStatus('Ready');
