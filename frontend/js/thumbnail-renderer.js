/**
 * Client-side thumbnail renderer.
 * Uses an offscreen Three.js canvas + FBXLoader, queues requests with
 * max concurrency, and persists results in IndexedDB.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const API        = 'http://localhost:8000/api';
const THUMB_SIZE = 128;
const CONCURRENCY = 3;
const CM_TO_M    = 0.01;
const BG_COLOR   = 0x1c1e28;

// ── IndexedDB cache ───────────────────────────────────────────────────────────

const _dbReady = new Promise((resolve) => {
  const req = indexedDB.open('maya-thumbs', 1);
  req.onupgradeneeded = e => e.target.result.createObjectStore('thumbs', { keyPath: 'id' });
  req.onsuccess  = e => resolve(e.target.result);
  req.onerror    = ()  => resolve(null); // degrade gracefully
});

async function _dbGet(id) {
  const db = await _dbReady;
  if (!db) return null;
  return new Promise(res => {
    const req = db.transaction('thumbs').objectStore('thumbs').get(id);
    req.onsuccess = () => res(req.result?.dataUrl ?? null);
    req.onerror   = () => res(null);
  });
}

async function _dbPut(id, dataUrl) {
  const db = await _dbReady;
  if (!db) return;
  const tx = db.transaction('thumbs', 'readwrite');
  tx.objectStore('thumbs').put({ id, dataUrl });
}

// ── Offscreen Three.js renderer ───────────────────────────────────────────────

let _renderer = null;
let _scene    = null;
let _camera   = null;
let _loader   = null;

function _init() {
  if (_renderer) return;

  const canvas  = document.createElement('canvas');
  canvas.width  = THUMB_SIZE;
  canvas.height = THUMB_SIZE;

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  _renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
  _renderer.setPixelRatio(1);
  _renderer.setClearColor(BG_COLOR, 1);

  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(BG_COLOR);
  _scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(4, 6, 4);
  _scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
  fill.position.set(-4, 2, -3);
  _scene.add(fill);

  _camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);

  _loader = new FBXLoader();
}

function _renderToDataUrl(fbx) {
  fbx.scale.multiplyScalar(CM_TO_M);

  const box  = new THREE.Box3().setFromObject(fbx);
  const cen  = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(cen);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  fbx.position.set(-cen.x, -cen.y, -cen.z);

  const dist = maxDim * 1.8;
  _camera.position.set(dist * 0.8, dist * 0.6, dist * 0.8);
  _camera.near = dist * 0.001;
  _camera.far  = dist * 20;
  _camera.lookAt(0, 0, 0);
  _camera.updateProjectionMatrix();

  _scene.add(fbx);
  _renderer.render(_scene, _camera);
  const dataUrl = _renderer.domElement.toDataURL('image/jpeg', 0.82);
  _scene.remove(fbx);

  // Free GPU resources
  fbx.traverse(c => {
    if (!c.isMesh) return;
    c.geometry?.dispose();
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach(m => { m?.map?.dispose(); m?.dispose(); });
  });

  return dataUrl;
}

async function _renderAsset(assetId) {
  _init();
  return new Promise(resolve => {
    _loader.load(
      `${API}/assets/${assetId}/fbx`,
      fbx  => resolve(_renderToDataUrl(fbx)),
      undefined,
      ()   => resolve(null),
    );
  });
}

// ── Request queue ─────────────────────────────────────────────────────────────

const _pending = new Map(); // assetId → [callbacks]
const _queue   = [];        // [assetId] in priority order
let   _active  = 0;

function _drain() {
  while (_active < CONCURRENCY && _queue.length) {
    const id = _queue.shift();
    if (!_pending.has(id)) continue; // cancelled (card removed)
    _active++;
    (async () => {
      try {
        let dataUrl = await _dbGet(id);
        if (!dataUrl) {
          dataUrl = await _renderAsset(id);
          if (dataUrl) _dbPut(id, dataUrl);
        }
        const cbs = _pending.get(id) || [];
        _pending.delete(id);
        cbs.forEach(cb => cb(dataUrl));
      } finally {
        _active--;
        _drain();
      }
    })();
  }
}

/**
 * Request a thumbnail for assetId.
 * Calls cb(dataUrl) when ready, or cb(null) on failure.
 * Calling again with the same id before it resolves just adds another callback.
 */
export function requestThumbnail(assetId, cb) {
  // Check IndexedDB first without blocking
  _dbGet(assetId).then(cached => {
    if (cached) { cb(cached); return; }
    if (_pending.has(assetId)) {
      _pending.get(assetId).push(cb);
    } else {
      _pending.set(assetId, [cb]);
      _queue.push(assetId);
    }
    _drain();
  });
}

/** Move assetId to the front of the queue (call when it scrolls into view). */
export function prioritiseThumbnail(assetId) {
  const idx = _queue.indexOf(assetId);
  if (idx > 0) { _queue.splice(idx, 1); _queue.unshift(assetId); }
}
