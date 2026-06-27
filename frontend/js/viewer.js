/**
 * Three.js 3D viewport – model loading, camera, gizmos, drag-drop placement.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { sceneManager } from './scene-manager.js';
import { LightManager } from './lights-manager.js';

const API = 'http://localhost:8000/api';

// ── Scene setup ──────────────────────────────────────────────────────────────

const canvas = document.getElementById('three-canvas');
const container = document.getElementById('viewport-container');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0e14);
// No fog — it obscures the scene when zooming out

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 50000);
camera.position.set(12, 8, 15);
camera.lookAt(0, 0, 0);

// ── Lighting ─────────────────────────────────────────────────────────────────

export const lightManager = new LightManager(scene);
lightManager.add('ambient',     { label: 'Ambient',    color: '#ffffff',  intensity: 0.6 });
lightManager.add('directional', { label: 'Sun',        color: '#fffbf0',  intensity: 1.2, x: 15, y: 20, z: 10, castShadow: true });
lightManager.add('directional', { label: 'Fill',       color: '#c0d8ff',  intensity: 0.3, x: -10, y: 5, z: -5, castShadow: false });
lightManager.setHelpersVisible(false);

// ── Grid ─────────────────────────────────────────────────────────────────────

const gridHelper = new THREE.GridHelper(500, 100, 0x2a2d42, 0x1c1e2c);
scene.add(gridHelper);

const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 1, metalness: 0 }),
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.receiveShadow = true;
groundPlane.name = '__ground__';
scene.add(groundPlane);

// ── Camera controls ───────────────────────────────────────────────────────────

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.06;
orbit.minDistance = 0.1;
orbit.maxDistance = 5000;

// ── Transform gizmo ───────────────────────────────────────────────────────────

const transformCtrl = new TransformControls(camera, renderer.domElement);
transformCtrl.addEventListener('dragging-changed', e => {
  orbit.enabled = !e.value;
  if (e.value) sceneManager.beginMove();
  else sceneManager.commitMove();
});
transformCtrl.addEventListener('change', () => {
  const obj = transformCtrl.object;
  if (!obj) return;
  const item = sceneManager.items.find(i => i.meshUuid === obj.uuid);
  if (item) {
    sceneManager.updateItem(item.id, {
      position: obj.position.toArray(),
      rotation: [
        THREE.MathUtils.radToDeg(obj.rotation.x),
        THREE.MathUtils.radToDeg(obj.rotation.y),
        THREE.MathUtils.radToDeg(obj.rotation.z),
      ],
      scale: obj.scale.x,
    });
    _updateSelectionInfo(obj);
  }
});
// r163+ separates visual helper; older builds add transformCtrl directly
if (typeof transformCtrl.getHelper === 'function') {
  scene.add(transformCtrl.getHelper());
} else {
  scene.add(transformCtrl);
}

// ── Light gizmo ───────────────────────────────────────────────────────────────

const lightGizmo = new TransformControls(camera, renderer.domElement);
lightGizmo.setMode('translate');
lightGizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
if (typeof lightGizmo.getHelper === 'function') {
  scene.add(lightGizmo.getHelper());
} else {
  scene.add(lightGizmo);
}

let _lgOnChange = null;
let _lgOnDragEnd = null;

lightGizmo.addEventListener('change', () => { if (_lgOnChange) _lgOnChange(); });
lightGizmo.addEventListener('dragging-changed', e => { if (!e.value && _lgOnDragEnd) _lgOnDragEnd(); });

export function attachLightGizmo(obj, onChange, onDragEnd) {
  lightGizmo.attach(obj);
  _lgOnChange = onChange;
  _lgOnDragEnd = onDragEnd;
}
export function detachLightGizmo() {
  lightGizmo.detach();
  _lgOnChange = null;
  _lgOnDragEnd = null;
}

// ── Internal maps ─────────────────────────────────────────────────────────────

const uuidToItem = new Map();   // mesh.uuid → item id
const itemToMesh = new Map();   // item id → THREE.Group

// ── Resize ───────────────────────────────────────────────────────────────────

function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(container);
resize();

// ── Render loop ───────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}
animate();

// ── GLTF loading ─────────────────────────────────────────────────────────────

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const loadingMap = new Map(); // assetId → Promise<Group>

const CM_TO_M = 0.01; // Maya exports in cm; convert to metres so 1 unit = 1 m

function _normalizeAndWrap(loaded) {
  // Convert from cm to metres (preserves real-world relative sizes)
  loaded.scale.multiplyScalar(CM_TO_M);

  // Sit on ground, centre X/Z pivot
  const box = new THREE.Box3().setFromObject(loaded);
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  loaded.position.set(-centre.x, -box.min.y, -centre.z);

  // Outer wrapper lets placeAsset's scale multiply on top cleanly
  const wrapper = new THREE.Group();
  wrapper.add(loaded);
  return wrapper;
}

function _placeholder() {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4466aa, roughness: 0.7 }),
  );
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

async function _loadModel(assetId) {
  if (loadingMap.has(assetId)) return loadingMap.get(assetId);

  const promise = new Promise((resolve) => {
    // Primary: FBX (served directly, no conversion needed)
    fbxLoader.load(
      `${API}/assets/${assetId}/fbx`,
      fbx => {
        fbx.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            // Improve default material appearance
            if (child.material) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach(m => { m.side = THREE.FrontSide; });
            }
          }
        });
        resolve(_normalizeAndWrap(fbx));
      },
      undefined,
      () => {
        gltfLoader.load(
          `${API}/assets/${assetId}/gltf`,
          gltf => {
            const group = gltf.scene;
            group.traverse(child => {
              if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
            });
            resolve(_normalizeAndWrap(group));
          },
          undefined,
          () => resolve(_placeholder()),
        );
      },
    );
  });

  loadingMap.set(assetId, promise);
  return promise;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function placeAsset(assetId, name, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1.0) {
  const template = await _loadModel(assetId);
  const group = template.clone(true);

  group.position.set(...position);
  group.rotation.set(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
  );
  group.scale.setScalar(scale);

  scene.add(group);

  const item = sceneManager.addItem(assetId, name, position, rotation, scale, group.uuid);
  uuidToItem.set(group.uuid, item.id);
  itemToMesh.set(item.id, group);

  return item;
}

export function getItemSurfaceY(itemId) {
  const group = itemToMesh.get(itemId);
  if (!group) return null;
  const box = new THREE.Box3().setFromObject(group);
  return parseFloat(box.max.y.toFixed(4));
}

export function removeAsset(itemId) {
  const group = itemToMesh.get(itemId);
  if (group) {
    if (transformCtrl.object === group) transformCtrl.detach();
    scene.remove(group);
    uuidToItem.delete(group.uuid);
    itemToMesh.delete(itemId);
  }
  sceneManager.removeItem(itemId);
}

export function clearScene() {
  itemToMesh.forEach((mesh, id) => {
    if (transformCtrl.object === mesh) transformCtrl.detach();
    scene.remove(mesh);
  });
  uuidToItem.clear();
  itemToMesh.clear();
  sceneManager.clearAll();
}

export function frameSelection() {
  const items = sceneManager.items;
  if (!items.length) {
    camera.position.set(8, 6, 10);
    orbit.target.set(0, 0, 0);
    orbit.update();
    return;
  }
  const box = new THREE.Box3();
  items.forEach(item => {
    const m = itemToMesh.get(item.id);
    if (m) box.expandByObject(m);
  });
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const dist = Math.max(size.length() * 1.2, 3);
  camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.6, dist));
  orbit.target.copy(center);
  orbit.update();
}

export function setTransformMode(mode) {
  // mode: 'translate' | 'rotate' | 'scale' | null
  if (!mode) {
    transformCtrl.detach();
    return;
  }
  transformCtrl.setMode(mode);
  const sel = sceneManager.getSelected();
  if (sel) {
    const mesh = itemToMesh.get(sel.id);
    if (mesh) transformCtrl.attach(mesh);
  }
}

export function getItemMeshGroup(itemId) { return itemToMesh.get(itemId) ?? null; }
export function getScene()  { return scene; }
export function getCamera() { return camera; }

export function setPaintMode(enabled) {
  orbit.enabled = !enabled;
  if (enabled) transformCtrl.detach();
}

export function setSnapEnabled(enabled) {
  const snap = enabled ? 1 : null;
  transformCtrl.setTranslationSnap(snap);
  transformCtrl.setRotationSnap(THREE.MathUtils.degToRad(15));
  transformCtrl.setScaleSnap(enabled ? 0.25 : null);
}

// ── Separate set into individual pieces ───────────────────────────────────────

export function getPieceCount() {
  const sel = sceneManager.getSelected();
  if (!sel) return 0;
  const wrapper = itemToMesh.get(sel.id);
  if (!wrapper) return 0;
  const inner = wrapper.children[0];
  return inner ? inner.children.filter(c => c.visible !== false).length : 0;
}

export function separateSelected() {
  const sel = sceneManager.getSelected();
  if (!sel) return 0;

  const wrapper = itemToMesh.get(sel.id);
  if (!wrapper) return 0;

  // Structure: wrapper → inner (CM_TO_M scaled FBX) → [piece1, piece2, ...]
  const inner = wrapper.children[0];
  if (!inner || inner.children.length === 0) return 0;

  const pieces = [...inner.children].filter(c => c.visible !== false);
  if (pieces.length <= 1) return 0;

  // Snapshot world transforms before removing the parent
  wrapper.updateWorldMatrix(true, true);

  const snapshots = pieces.map(piece => {
    piece.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    piece.matrixWorld.decompose(pos, quat, scl);
    return { clone: piece.clone(true), pos, quat, scl, name: piece.name || sel.name };
  });

  // Remove the original grouped object
  removeAsset(sel.id);

  // Re-add each piece as an independent scene object
  snapshots.forEach(({ clone, pos, quat, scl, name }) => {
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);

    const newWrapper = new THREE.Group();
    newWrapper.position.copy(pos);
    newWrapper.quaternion.copy(quat);
    newWrapper.scale.copy(scl);
    newWrapper.add(clone);
    scene.add(newWrapper);

    const euler = new THREE.Euler().setFromQuaternion(quat);
    const item = sceneManager.addItem(
      sel.assetId,
      name,
      pos.toArray(),
      [THREE.MathUtils.radToDeg(euler.x), THREE.MathUtils.radToDeg(euler.y), THREE.MathUtils.radToDeg(euler.z)],
      scl.x,
      newWrapper.uuid,
    );
    uuidToItem.set(newWrapper.uuid, item.id);
    itemToMesh.set(item.id, newWrapper);
  });

  return snapshots.length;
}

// ── Free-position finder ──────────────────────────────────────────────────────

const PLACE_SPACING = 4; // minimum metres between placed object centres

export function findFreePosition() {
  const occupied = sceneManager.items.map(i => i.position);

  function isFree(x, z) {
    return !occupied.some(p => {
      const dx = x - p[0], dz = z - p[2];
      return Math.sqrt(dx * dx + dz * dz) < PLACE_SPACING;
    });
  }

  // Spiral outward from origin until a free cell is found
  for (let ring = 0; ring <= 15; ring++) {
    if (ring === 0) {
      if (isFree(0, 0)) return [0, 0, 0];
      continue;
    }
    const step = PLACE_SPACING;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const x = dx * step, z = dz * step;
        if (isFree(x, z)) return [x, 0, z];
      }
    }
  }

  return [(Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30];
}

// ── Drop onto viewport ────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();

export function dropAssetAtCursor(assetId, name, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(groundPlane);
  const pt = hits.length ? hits[0].point : new THREE.Vector3(0, 0, 0);
  return placeAsset(assetId, name, [pt.x, 0, pt.z]);
}

// ── Click selection ───────────────────────────────────────────────────────────

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const meshList = [];
  itemToMesh.forEach(group => {
    group.traverse(child => { if (child.isMesh) meshList.push(child); });
  });
  const hits = raycaster.intersectObjects(meshList);
  if (!hits.length) {
    sceneManager.deselect();
    transformCtrl.detach();
    return;
  }
  // Walk up to find the group
  let obj = hits[0].object;
  while (obj.parent && !uuidToItem.has(obj.uuid) && !uuidToItem.has(obj.parent.uuid)) {
    obj = obj.parent;
  }
  // Find root group
  itemToMesh.forEach((group, id) => {
    if (group === obj || group.getObjectByProperty('uuid', obj.uuid)) {
      sceneManager.select(id);
      transformCtrl.attach(group);
      _updateSelectionInfo(group);
    }
  });
});

function _updateSelectionInfo(obj) {
  const info = document.getElementById('selection-info');
  const selName = document.getElementById('sel-name');
  const selPos = document.getElementById('sel-pos');
  if (!info) return;
  const item = sceneManager.getSelected();
  if (!item) { info.style.display = 'none'; return; }
  info.style.display = 'flex';
  selName.textContent = item.name;
  selPos.textContent = `${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)}`;
}

// ── Scene manager → viewer sync ───────────────────────────────────────────────

// Re-creates the mesh for an item that was restored by undo (item already exists in sceneManager)
async function _reloadItemMesh(item) {
  const template = await _loadModel(item.assetId);
  const group = template.clone(true);
  group.position.fromArray(item.position);
  group.rotation.set(
    THREE.MathUtils.degToRad(item.rotation[0]),
    THREE.MathUtils.degToRad(item.rotation[1]),
    THREE.MathUtils.degToRad(item.rotation[2])
  );
  group.scale.setScalar(item.scale);
  scene.add(group);
  uuidToItem.set(group.uuid, item.id);
  itemToMesh.set(item.id, group);
  sceneManager.updateItem(item.id, { meshUuid: group.uuid });
}

sceneManager.addEventListener('add', e => {
  const { item } = e.detail;
  // Skip if a mesh with this UUID is already in the scene (normal placeAsset flow).
  // item.meshUuid is set by placeAsset before addItem fires this event.
  if (item.meshUuid && scene.getObjectByProperty('uuid', item.meshUuid)) return;
  _reloadItemMesh(item);
});

sceneManager.addEventListener('update', e => {
  const { item } = e.detail;
  const group = itemToMesh.get(item.id);
  if (!group) return;
  group.position.fromArray(item.position);
  group.rotation.set(
    THREE.MathUtils.degToRad(item.rotation[0]),
    THREE.MathUtils.degToRad(item.rotation[1]),
    THREE.MathUtils.degToRad(item.rotation[2])
  );
  group.scale.setScalar(item.scale);
});

sceneManager.addEventListener('remove', e => {
  const { item } = e.detail;
  const group = itemToMesh.get(item.id);
  if (group) {
    if (transformCtrl.object === group) transformCtrl.detach();
    scene.remove(group);
    uuidToItem.delete(group.uuid);
    itemToMesh.delete(item.id);
  }
});

sceneManager.addEventListener('selectionChange', e => {
  const { next } = e.detail;
  const infoEl = document.getElementById('selection-info');
  if (!next) {
    transformCtrl.detach();
    if (infoEl) infoEl.style.display = 'none';
    return;
  }
  const group = itemToMesh.get(next);
  if (group) {
    transformCtrl.attach(group);
    _updateSelectionInfo(group);
  }
});
