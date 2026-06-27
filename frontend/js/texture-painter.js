/**
 * TexturePainter – UV-projected 3D texture painting engine.
 * Supports: Albedo, Roughness, Metalness, Emissive, Height→Normal channels.
 * Brush types: soft round, hard round, square, spray, smear, grunge, blob,
 *              hatching, dots, erase.
 * Layer system with blend modes. Undo stack. Normal map via Sobel from height.
 */

import * as THREE from 'three';

export const TEX_SIZE = 2048;

export const CHANNELS = {
  albedo:    { label: 'Albedo',       fill: '#808080', isColor: true,  srgb: true  },
  roughness: { label: 'Roughness',    fill: '#808080', isColor: false, srgb: false },
  metalness: { label: 'Metalness',    fill: '#000000', isColor: false, srgb: false },
  emissive:  { label: 'Emissive',     fill: '#000000', isColor: true,  srgb: true  },
  height:    { label: 'Height→Normal',fill: '#808080', isColor: false, srgb: false },
};

const BLEND_OPS = {
  Normal:     'source-over',
  Multiply:   'multiply',
  Screen:     'screen',
  Overlay:    'overlay',
  Add:        'lighter',
  Darken:     'darken',
  Lighten:    'lighten',
  SoftLight:  'soft-light',
  HardLight:  'hard-light',
  Difference: 'difference',
};

export const BLEND_MODES = Object.keys(BLEND_OPS);

export class TexturePainter {
  constructor(threeScene, threeCamera, threeCanvas) {
    this._scene   = threeScene;
    this._camera  = threeCamera;
    this._canvas  = threeCanvas;
    this._ray     = new THREE.Raycaster();

    this._active        = false;
    this._targetItemId  = null;
    this._targetMeshes  = [];

    // Composite output textures (drawn by _composite())
    this._ch = {};   // channel → { canvas, ctx, texture }
    // Paint layers per channel
    this._layers     = {};  // channel → Layer[]
    this._activeIdx  = {};  // channel → int

    // Normal map from height
    this._normCanvas  = null;
    this._normCtx     = null;
    this._normTex     = null;

    this.brush = {
      type:            'round_soft',
      channel:         'albedo',
      color:           '#c47a3a',
      value:           0.5,
      size:            30,
      opacity:         0.8,
      hardness:        0.5,
      flow:            1.0,
      spacing:         0.25,
      heightStrength:  4.0,
    };

    this._painting       = false;
    this._lastStampUV    = null;
    this._lastUV         = null;
    this._strokeDir      = { x: 1, y: 0 };

    this._undoStack = [];
    this._maxUndo   = 30;
    this._origMats  = new Map();

    // Public callbacks
    this.onChange = null;   // (event, channel) => void
  }

  // ── State ───────────────────────────────────────────────────────────────────

  get active()       { return this._active; }
  get targetItemId() { return this._targetItemId; }

  // ── Activate / Deactivate ───────────────────────────────────────────────────

  activate(itemId, meshGroup) {
    if (this._active) this.deactivate();

    this._targetItemId = itemId;
    this._targetMeshes = [];

    meshGroup.traverse(child => {
      if (!child.isMesh) return;
      if (!child.geometry.attributes.uv) this._genBoxUV(child.geometry);
      this._targetMeshes.push(child);
    });

    if (!this._targetMeshes.length) return false;

    // Build channel canvases + initial base layers
    for (const ch of Object.keys(CHANNELS)) {
      this._ch[ch]         = this._mkChannelCanvas(ch);
      this._layers[ch]     = [];
      this._activeIdx[ch]  = 0;
      this._addLayerRaw(ch, 'Base', true);  // fill with default
    }

    // Normal map canvas
    this._normCanvas        = document.createElement('canvas');
    this._normCanvas.width  = this._normCanvas.height = TEX_SIZE;
    this._normCtx           = this._normCanvas.getContext('2d');
    this._normTex           = new THREE.CanvasTexture(this._normCanvas);
    this._normTex.colorSpace = THREE.LinearSRGBColorSpace;
    this._solveNormal();

    // Replace materials with PBR that references our canvases
    this._targetMeshes.forEach(mesh => {
      this._origMats.set(mesh.uuid, mesh.material);
      const mat = new THREE.MeshStandardMaterial({
        map:          this._ch.albedo.texture,
        roughnessMap: this._ch.roughness.texture,
        roughness:    1.0,
        metalnessMap: this._ch.metalness.texture,
        metalness:    1.0,
        emissiveMap:  this._ch.emissive.texture,
        emissive:     new THREE.Color(1, 1, 1),
        normalMap:    this._normTex,
        normalScale:  new THREE.Vector2(1, 1),
      });
      mat.needsUpdate = true;
      mesh.material   = mat;
    });

    this._active = true;
    this._bindEvents();
    return true;
  }

  deactivate() {
    if (!this._active) return;
    this._unbindEvents();
    this._targetMeshes.forEach(mesh => {
      const orig = this._origMats.get(mesh.uuid);
      if (orig) mesh.material = orig;
    });
    this._origMats.clear();
    this._active       = false;
    this._targetMeshes = [];
    this._targetItemId = null;
    this._painting     = false;
  }

  // ── Channel canvas setup ────────────────────────────────────────────────────

  _mkChannelCanvas(ch) {
    const canvas  = document.createElement('canvas');
    canvas.width  = canvas.height = TEX_SIZE;
    const ctx     = canvas.getContext('2d');
    ctx.fillStyle = CHANNELS[ch].fill;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    const texture           = new THREE.CanvasTexture(canvas);
    texture.colorSpace      = CHANNELS[ch].srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    return { canvas, ctx, texture };
  }

  // ── Layer management ────────────────────────────────────────────────────────

  _addLayerRaw(ch, name, fillDefault = false) {
    const canvas  = document.createElement('canvas');
    canvas.width  = canvas.height = TEX_SIZE;
    const ctx     = canvas.getContext('2d');
    if (fillDefault) {
      ctx.fillStyle = CHANNELS[ch].fill;
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }
    const layer = { name, canvas, ctx, opacity: 1.0, blendMode: 'Normal', visible: true };
    this._layers[ch].push(layer);
    this._activeIdx[ch] = this._layers[ch].length - 1;
    return layer;
  }

  addLayer(ch, name = 'Layer') {
    const layer = this._addLayerRaw(ch, name, false);
    this._composite(ch);
    this.onChange?.('layersChanged', ch);
    return layer;
  }

  removeLayer(ch, idx) {
    if (this._layers[ch].length <= 1) return;
    this._layers[ch].splice(idx, 1);
    this._activeIdx[ch] = Math.min(idx, this._layers[ch].length - 1);
    this._composite(ch);
    this.onChange?.('layersChanged', ch);
  }

  setActiveLayer(ch, idx) {
    this._activeIdx[ch] = idx;
  }

  getActiveLayer(ch) {
    const idx = this._activeIdx[ch] ?? 0;
    return this._layers[ch]?.[idx] ?? null;
  }

  updateLayer(ch, idx, patch) {
    const layer = this._layers[ch]?.[idx];
    if (!layer) return;
    Object.assign(layer, patch);
    this._composite(ch);
    this.onChange?.('layersChanged', ch);
  }

  getLayers(ch) { return this._layers[ch] ?? []; }

  _composite(ch) {
    const { ctx } = this._ch[ch];
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.fillStyle = CHANNELS[ch].fill;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    for (const layer of this._layers[ch]) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha                = layer.opacity;
      ctx.globalCompositeOperation   = BLEND_OPS[layer.blendMode] ?? 'source-over';
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
    this._ch[ch].texture.needsUpdate = true;
  }

  // ── Normal map from height (Sobel) ──────────────────────────────────────────

  _solveNormal() {
    if (!this._ch.height) return;
    const size  = TEX_SIZE;
    const hImg  = this._ch.height.ctx.getImageData(0, 0, size, size);
    const nData = this._normCtx.createImageData(size, size);
    const s     = this.brush.heightStrength;

    const h = (x, y) => {
      const xi = Math.max(0, Math.min(size - 1, x));
      const yi = Math.max(0, Math.min(size - 1, y));
      return hImg.data[(yi * size + xi) * 4] / 255;
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dX = (h(x+1,y-1) + 2*h(x+1,y) + h(x+1,y+1)) - (h(x-1,y-1) + 2*h(x-1,y) + h(x-1,y+1));
        const dY = (h(x-1,y+1) + 2*h(x,y+1) + h(x+1,y+1)) - (h(x-1,y-1) + 2*h(x,y-1) + h(x+1,y-1));
        let nx = -dX * s, ny = -dY * s, nz = 1.0;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * size + x) * 4;
        nData.data[i]   = Math.round((nx * 0.5 + 0.5) * 255);
        nData.data[i+1] = Math.round((ny * 0.5 + 0.5) * 255);
        nData.data[i+2] = Math.round((nz * 0.5 + 0.5) * 255);
        nData.data[i+3] = 255;
      }
    }

    this._normCtx.putImageData(nData, 0, 0);
    this._normTex.needsUpdate = true;
  }

  // ── Box UV fallback ─────────────────────────────────────────────────────────

  _genBoxUV(geo) {
    const pos  = geo.attributes.position;
    const uvs  = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      let u, v;
      if (ax >= ay && ax >= az)      { u = z / (ax * 2) + 0.5; v = y / (ax * 2) + 0.5; }
      else if (ay >= ax && ay >= az) { u = x / (ay * 2) + 0.5; v = z / (ay * 2) + 0.5; }
      else                           { u = x / (az * 2) + 0.5; v = y / (az * 2) + 0.5; }
      uvs[i * 2]     = u;
      uvs[i * 2 + 1] = v;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  _bindEvents() {
    this._onDown = this._handleDown.bind(this);
    this._onMove = this._handleMove.bind(this);
    this._onUp   = this._handleUp.bind(this);
    this._canvas.addEventListener('pointerdown', this._onDown, true);
    this._canvas.addEventListener('pointermove', this._onMove, true);
    window.addEventListener('pointerup', this._onUp);
  }

  _unbindEvents() {
    this._canvas.removeEventListener('pointerdown', this._onDown, true);
    this._canvas.removeEventListener('pointermove', this._onMove, true);
    window.removeEventListener('pointerup', this._onUp);
  }

  _hitUV(e) {
    const rect = this._canvas.getBoundingClientRect();
    const ndc  = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(ndc, this._camera);
    const hits = this._ray.intersectObjects(this._targetMeshes, false);
    return (hits.length && hits[0].uv) ? hits[0].uv : null;
  }

  _handleDown(e) {
    if (!this._active || e.button !== 0) return;
    const uv = this._hitUV(e);
    if (!uv) return;
    e.stopPropagation();
    this._painting     = true;
    this._lastStampUV  = uv.clone();
    this._lastUV       = uv.clone();
    this._strokeDir    = { x: 1, y: 0 };
    this._pushUndo();
    this._doPaint(uv, null);
  }

  _handleMove(e) {
    if (!this._active) {
      this.onChange?.('cursorMove', e);
      return;
    }
    this.onChange?.('cursorMove', e);
    if (!this._painting) return;
    const uv = this._hitUV(e);
    if (!uv) return;
    e.stopPropagation();

    if (this._lastUV) {
      const dx = uv.x - this._lastUV.x, dy = uv.y - this._lastUV.y;
      const l  = Math.sqrt(dx * dx + dy * dy);
      if (l > 0.0001) this._strokeDir = { x: dx / l, y: dy / l };
    }

    if (this._lastStampUV) {
      const dx = uv.x - this._lastStampUV.x, dy = uv.y - this._lastStampUV.y;
      const dist    = Math.sqrt(dx * dx + dy * dy);
      const spacing = (this.brush.size / TEX_SIZE) * Math.max(0.01, this.brush.spacing);
      if (dist >= spacing) {
        this._doPaint(uv, this._lastUV);
        this._lastStampUV = uv.clone();
      }
    }
    this._lastUV = uv.clone();
  }

  _handleUp() {
    if (!this._painting) return;
    this._painting    = false;
    this._lastStampUV = null;
    this._lastUV      = null;
    if (this.brush.channel === 'height') this._solveNormal();
    this.onChange?.('strokeEnd', this.brush.channel);
  }

  // ── Paint dispatch ──────────────────────────────────────────────────────────

  _doPaint(uv, prevUV) {
    const ch    = this.brush.channel;
    const layer = this.getActiveLayer(ch);
    if (!layer) return;

    const x    = uv.x * TEX_SIZE;
    const y    = (1 - uv.y) * TEX_SIZE;
    const r    = this.brush.size / 2;
    const grey = ch === 'roughness' || ch === 'metalness' || ch === 'height';
    const col  = grey ? this._greyHex(this.brush.value) : this.brush.color;
    const ctx  = layer.ctx;

    ctx.save();
    switch (this.brush.type) {
      case 'round_soft':  this._bSoft(ctx, x, y, r, col);              break;
      case 'round_hard':  this._bHard(ctx, x, y, r, col);              break;
      case 'square':      this._bSquare(ctx, x, y, r, col);            break;
      case 'spray':       this._bSpray(ctx, x, y, r, col);             break;
      case 'smear':       this._bSmear(ctx, layer.canvas, x, y, r, prevUV); break;
      case 'grunge':      this._bGrunge(ctx, x, y, r, col);            break;
      case 'blob':        this._bBlob(ctx, x, y, r, col);              break;
      case 'hatching':    this._bHatch(ctx, x, y, r, col);             break;
      case 'dots':        this._bDots(ctx, x, y, r, col);              break;
      case 'erase':       this._bErase(ctx, x, y, r);                  break;
    }
    ctx.restore();

    this._composite(ch);
  }

  // ── Brush implementations ───────────────────────────────────────────────────

  _bSoft(ctx, x, y, r, col) {
    const a = this.brush.opacity * this.brush.flow;
    const g = ctx.createRadialGradient(x, y, r * this.brush.hardness, x, y, r);
    g.addColorStop(0, this._rgba(col, a));
    g.addColorStop(1, this._rgba(col, 0));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  _bHard(ctx, x, y, r, col) {
    const a = this.brush.opacity * this.brush.flow;
    const g = ctx.createRadialGradient(x, y, r * this.brush.hardness, x, y, r);
    g.addColorStop(0, this._rgba(col, a));
    g.addColorStop(1, this._rgba(col, a * 0.05));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  _bSquare(ctx, x, y, r, col) {
    const a = this.brush.opacity * this.brush.flow;
    const { x: dx, y: dy } = this._strokeDir;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this._rgba(col, a);
    ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
    ctx.restore();
  }

  _bSpray(ctx, x, y, r, col) {
    const a     = (this.brush.opacity * this.brush.flow) / 8;
    const count = Math.round(r * r * 0.18 * this.brush.flow);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < count; i++) {
      const ang  = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.5) * r;
      const px   = x + Math.cos(ang) * dist;
      const py   = y + Math.sin(ang) * dist;
      ctx.fillStyle = this._rgba(col, a + Math.random() * a);
      ctx.beginPath(); ctx.arc(px, py, 1 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  _bSmear(ctx, src, x, y, r, prevUV) {
    if (!prevUV) return;
    const px = prevUV.x * TEX_SIZE;
    const py = (1 - prevUV.y) * TEX_SIZE;
    ctx.save();
    ctx.globalAlpha = this.brush.opacity * 0.55;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(src, px - r * 1.3, py - r * 1.3, r * 2.6, r * 2.6, x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  _bGrunge(ctx, x, y, r, col) {
    const base = this.brush.opacity * this.brush.flow;
    ctx.globalCompositeOperation = 'source-over';
    const count = 50 + Math.floor(r);
    for (let i = 0; i < count; i++) {
      const ang  = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.3) * r;
      const px   = x + Math.cos(ang) * dist;
      const py   = y + Math.sin(ang) * dist;
      const sr   = r * (0.015 + Math.random() * 0.1);
      ctx.fillStyle = this._rgba(col, base * (0.15 + Math.random() * 0.85));
      ctx.beginPath(); ctx.arc(px, py, sr, 0, Math.PI * 2); ctx.fill();
    }
  }

  _bBlob(ctx, x, y, r, col) {
    const a = this.brush.opacity * this.brush.flow;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this._rgba(col, a);
    ctx.beginPath();
    const pts = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i <= pts; i++) {
      const ang  = (i / pts) * Math.PI * 2;
      const vary = r * (0.5 + Math.random() * 0.9);
      const px   = x + Math.cos(ang) * vary;
      const py   = y + Math.sin(ang) * vary;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  _bHatch(ctx, x, y, r, col) {
    const a = this.brush.opacity * this.brush.flow;
    const { x: dx, y: dy } = this._strokeDir;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = this._rgba(col, a);
    ctx.lineWidth   = 1.5;
    const lines = Math.round(r / 4);
    for (let i = -lines; i <= lines; i++) {
      const ox = -dy * i * 4, oy = dx * i * 4;
      ctx.beginPath();
      ctx.moveTo(x + ox - dx * r, y + oy - dy * r);
      ctx.lineTo(x + ox + dx * r, y + oy + dy * r);
      ctx.stroke();
    }
  }

  _bDots(ctx, x, y, r, col) {
    const a = this.brush.opacity * this.brush.flow;
    ctx.globalCompositeOperation = 'source-over';
    const sp = r * 0.28;
    for (let oy = -r; oy <= r; oy += sp) {
      for (let ox = -r; ox <= r; ox += sp) {
        if (ox * ox + oy * oy <= r * r) {
          const falloff = 1 - Math.sqrt(ox * ox + oy * oy) / r;
          ctx.fillStyle = this._rgba(col, a * falloff);
          ctx.beginPath(); ctx.arc(x + ox, y + oy, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  _bErase(ctx, x, y, r) {
    const a = this.brush.opacity * this.brush.flow;
    const g = ctx.createRadialGradient(x, y, r * this.brush.hardness, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // ── Undo ────────────────────────────────────────────────────────────────────

  _pushUndo() {
    const snap = {};
    for (const ch of Object.keys(CHANNELS)) {
      const layer = this.getActiveLayer(ch);
      if (layer) snap[ch] = layer.ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    }
    this._undoStack.push(snap);
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
  }

  undo() {
    if (!this._undoStack.length) return;
    const snap = this._undoStack.pop();
    for (const [ch, img] of Object.entries(snap)) {
      const layer = this.getActiveLayer(ch);
      if (layer) { layer.ctx.putImageData(img, 0, 0); this._composite(ch); }
    }
    this._solveNormal();
    this.onChange?.('undo', null);
  }

  get canUndo() { return this._undoStack.length > 0; }

  // ── Fill ────────────────────────────────────────────────────────────────────

  fillLayer(ch, color) {
    const layer = this.getActiveLayer(ch);
    if (!layer) return;
    this._pushUndo();
    layer.ctx.fillStyle = color;
    layer.ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this._composite(ch);
    if (ch === 'height') this._solveNormal();
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  exportChannel(ch) { return this._ch[ch]?.canvas.toDataURL('image/png') ?? null; }
  exportNormal()    { return this._normCanvas?.toDataURL('image/png') ?? null; }

  exportAll() {
    const result = {};
    for (const ch of Object.keys(CHANNELS)) {
      result[ch] = this.exportChannel(ch);
    }
    result.normal = this.exportNormal();
    return result;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [255, 255, 255];
  }

  _rgba(hex, a) {
    const [r, g, b] = this._hexToRgb(hex);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
  }

  _greyHex(v) {
    const c = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return `#${c}${c}${c}`;
  }
}
