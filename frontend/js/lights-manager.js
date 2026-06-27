import * as THREE from 'three';
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();

export const LIGHT_TYPES = {
  ambient:     { label: 'Ambient',      icon: '◎' },
  directional: { label: 'Directional',  icon: '☀' },
  point:       { label: 'Point',        icon: '●' },
  spot:        { label: 'Spot',         icon: '▽' },
  hemisphere:  { label: 'Hemisphere',   icon: '◑' },
  rectarea:    { label: 'Area (Rect)',   icon: '▭' },
};

const _typeCounts = {};

export class LightManager extends EventTarget {
  constructor(scene) {
    super();
    this._scene = scene;
    this._entries = [];
    this._nextId = 1;
    this._helpersVisible = true;
  }

  get entries() { return [...this._entries]; }

  add(type, params = {}) {
    _typeCounts[type] = (_typeCounts[type] || 0) + 1;
    const p = { label: `${LIGHT_TYPES[type].label} ${_typeCounts[type]}`, ..._defaults(type), ...params };
    const { light, helper } = _build(type, p);
    const entry = { id: this._nextId++, type, light, helper, params: p };
    this._scene.add(light);
    if (light.target) this._scene.add(light.target);
    if (helper) { helper.visible = this._helpersVisible; this._scene.add(helper); }
    this._entries.push(entry);
    this._emit();
    return entry;
  }

  remove(id) {
    const idx = this._entries.findIndex(e => e.id === id);
    if (idx === -1) return;
    const { light, helper } = this._entries[idx];
    this._scene.remove(light);
    if (light.target) this._scene.remove(light.target);
    if (helper) this._scene.remove(helper);
    this._entries.splice(idx, 1);
    this._emit();
  }

  update(id, patch) {
    const entry = this._entries.find(e => e.id === id);
    if (!entry) return;
    Object.assign(entry.params, patch);
    _apply(entry);
    this._emit();
  }

  setHelpersVisible(v) {
    this._helpersVisible = v;
    this._entries.forEach(({ helper }) => { if (helper) helper.visible = v; });
  }

  _emit() { this.dispatchEvent(new CustomEvent('change')); }
}

function _defaults(type) {
  switch (type) {
    case 'ambient':     return { color: '#ffffff', intensity: 0.5 };
    case 'directional': return { color: '#fffbf0', intensity: 1.2, x: 10, y: 20, z: 10, targetX: 0, targetY: 0, targetZ: 0, castShadow: true };
    case 'point':       return { color: '#ffffff', intensity: 1.0, x: 0, y: 5, z: 0, distance: 0, decay: 2 };
    case 'spot':        return { color: '#ffffff', intensity: 1.5, x: 0, y: 10, z: 0, targetX: 0, targetY: 0, targetZ: 0, angle: 30, penumbra: 0.15, distance: 0, decay: 2, castShadow: false };
    case 'hemisphere':  return { skyColor: '#87ceeb', groundColor: '#8b4513', intensity: 0.6 };
    case 'rectarea':    return { color: '#ffffff', intensity: 2.0, x: 0, y: 5, z: 0, rotX: -90, rotY: 0, rotZ: 0, width: 5, height: 5 };
    default: return {};
  }
}

function _build(type, p) {
  let light, helper;
  switch (type) {
    case 'ambient': {
      light = new THREE.AmbientLight(p.color, p.intensity);
      break;
    }
    case 'directional': {
      light = new THREE.DirectionalLight(p.color, p.intensity);
      light.position.set(p.x, p.y, p.z);
      light.target.position.set(p.targetX ?? 0, p.targetY ?? 0, p.targetZ ?? 0);
      if (p.castShadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(2048, 2048);
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 500;
        light.shadow.camera.left = light.shadow.camera.bottom = -50;
        light.shadow.camera.right = light.shadow.camera.top = 50;
      }
      helper = new THREE.DirectionalLightHelper(light, 2);
      break;
    }
    case 'point': {
      light = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay);
      light.position.set(p.x, p.y, p.z);
      helper = new THREE.PointLightHelper(light, 0.5);
      break;
    }
    case 'spot': {
      light = new THREE.SpotLight(p.color, p.intensity, p.distance, THREE.MathUtils.degToRad(p.angle), p.penumbra, p.decay);
      light.position.set(p.x, p.y, p.z);
      light.target.position.set(p.targetX ?? 0, p.targetY ?? 0, p.targetZ ?? 0);
      if (p.castShadow) light.castShadow = true;
      helper = new THREE.SpotLightHelper(light);
      break;
    }
    case 'hemisphere': {
      light = new THREE.HemisphereLight(p.skyColor, p.groundColor, p.intensity);
      helper = new THREE.HemisphereLightHelper(light, 1);
      break;
    }
    case 'rectarea': {
      light = new THREE.RectAreaLight(p.color, p.intensity, p.width, p.height);
      light.position.set(p.x, p.y, p.z);
      light.rotation.set(
        THREE.MathUtils.degToRad(p.rotX),
        THREE.MathUtils.degToRad(p.rotY),
        THREE.MathUtils.degToRad(p.rotZ),
      );
      helper = new RectAreaLightHelper(light);
      break;
    }
    default: light = new THREE.AmbientLight();
  }
  return { light, helper };
}

function _apply(entry) {
  const { type, light, helper, params: p } = entry;
  if (type === 'hemisphere') {
    light.color.set(p.skyColor);
    light.groundColor.set(p.groundColor);
  } else {
    light.color.set(p.color);
  }
  light.intensity = p.intensity;
  if (['directional', 'point', 'spot', 'rectarea'].includes(type)) light.position.set(p.x, p.y, p.z);
  if ((type === 'directional' || type === 'spot') && light.target) {
    light.target.position.set(p.targetX ?? 0, p.targetY ?? 0, p.targetZ ?? 0);
    light.target.updateMatrixWorld();
  }
  if (type === 'point' || type === 'spot') { light.distance = p.distance; light.decay = p.decay; }
  if (type === 'spot') { light.angle = THREE.MathUtils.degToRad(p.angle); light.penumbra = p.penumbra; light.castShadow = p.castShadow; }
  if (type === 'rectarea') {
    light.width = p.width; light.height = p.height;
    light.rotation.set(THREE.MathUtils.degToRad(p.rotX), THREE.MathUtils.degToRad(p.rotY), THREE.MathUtils.degToRad(p.rotZ));
  }
  if (type === 'directional') light.castShadow = p.castShadow;
  if (helper && typeof helper.update === 'function') helper.update();
}
