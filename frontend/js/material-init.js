/**
 * Material system initialiser.
 * Wires initMaterialPanel to the Three.js viewer.
 */

import * as THREE from 'three';
import { sceneManager }                                       from './scene-manager.js';
import { getItemMeshGroup, getMeshGroupAtCursor }             from './viewer.js';
import { initMaterialPanel, openMaterialPanel, closeMaterialPanel, isMaterialPanelOpen } from './material-panel.js';

const _texLoader = new THREE.TextureLoader();

// ── Build THREE.MeshStandardMaterial from a library preset ───────────────────

function _buildThreeMat(preset) {
  const mat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(preset.color ?? '#808080'),
    roughness: preset.roughness ?? 0.5,
    metalness: preset.metalness ?? 0.0,
  });

  if (preset.transparent) {
    mat.transparent = true;
    mat.opacity     = preset.opacity ?? 0.5;
    mat.depthWrite  = false;
    mat.side        = THREE.DoubleSide;
  }

  if (preset.emissive) {
    mat.emissive          = new THREE.Color(preset.emissive);
    mat.emissiveIntensity = preset.emissiveIntensity ?? 1.0;
  }

  if (preset.maps) {
    if (preset.maps.albedo) {
      mat.map            = _texLoader.load(preset.maps.albedo);
      mat.map.colorSpace = THREE.SRGBColorSpace;
    }
    if (preset.maps.roughness) mat.roughnessMap = _texLoader.load(preset.maps.roughness);
    if (preset.maps.metalness) mat.metalnessMap = _texLoader.load(preset.maps.metalness);
    if (preset.maps.normal)    mat.normalMap    = _texLoader.load(preset.maps.normal);
    if (preset.maps.ao)        mat.aoMap        = _texLoader.load(preset.maps.ao);
  }

  mat.needsUpdate = true;
  return mat;
}

// ── Apply preset to every mesh inside a wrapper group ────────────────────────

function _applyToGroup(group, preset) {
  const shared = _buildThreeMat(preset);

  group.traverse(child => {
    if (!child.isMesh) return;
    // Dispose the old material to free GPU resources
    const prev = Array.isArray(child.material) ? child.material : [child.material];
    prev.forEach(m => m?.dispose?.());
    child.material = shared.clone();
    child.material.needsUpdate = true;
  });

  shared.dispose();   // Template; clones own their own texture refs
}

// ── Main apply callback  ──────────────────────────────────────────────────────

function applyMaterial(preset, target) {
  if (target === null) {
    // Clicked swatch → apply to selected item
    const sel = sceneManager.getSelected();
    if (!sel) {
      _setStatus('Select an object first, then click a material to apply it');
      return;
    }
    const group = getItemMeshGroup(sel.id);
    if (!group) return;
    _applyToGroup(group, preset);
    _setStatus(`Applied "${preset.name}" to ${sel.name}`);
  } else if (target?.clientX != null) {
    // Dropped onto viewport → raycast to mesh
    const group = getMeshGroupAtCursor(target.clientX, target.clientY);
    if (!group) return;
    _applyToGroup(group, preset);
    _setStatus(`Applied "${preset.name}"`);
  }
}

// ── Status bar helper ─────────────────────────────────────────────────────────

function _setStatus(msg) {
  const el = document.getElementById('status-left');
  if (el) el.textContent = msg;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

initMaterialPanel(applyMaterial);

document.getElementById('vp-btn-mat')?.addEventListener('click', () => {
  if (isMaterialPanelOpen()) closeMaterialPanel();
  else openMaterialPanel();
});
