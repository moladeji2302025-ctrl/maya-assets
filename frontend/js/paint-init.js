/**
 * Paint mode wiring – bootstraps TexturePainter after viewer is ready.
 */

import { sceneManager }                                    from './scene-manager.js';
import { getScene, getCamera, getItemMeshGroup, setPaintMode } from './viewer.js';
import { TexturePainter }                                  from './texture-painter.js';
import { initPaintPanel, openPaintPanel, closePaintPanel, isPaintActive } from './paint-panel.js';

const canvas  = document.getElementById('three-canvas');
const painter = new TexturePainter(getScene(), getCamera(), canvas);
initPaintPanel(painter);

const paintBtn = document.getElementById('vp-btn-paint');

paintBtn?.addEventListener('click', () => {
  if (isPaintActive()) {
    closePaintPanel();
    setPaintMode(false);
    paintBtn.classList.remove('active');
    return;
  }

  const sel = sceneManager.getSelected();
  if (!sel) {
    const st = document.getElementById('status-left');
    if (st) st.textContent = 'Select an object first, then click Paint';
    return;
  }

  const group = getItemMeshGroup(sel.id);
  if (!group) return;

  openPaintPanel(sel.id, group);
  setPaintMode(true);
  paintBtn.classList.add('active');
});

// Exit paint mode when user deselects everything
sceneManager.addEventListener('selectionChange', e => {
  if (!e.detail.next && isPaintActive()) {
    closePaintPanel();
    setPaintMode(false);
  }
});
