/**
 * Material library – built-in PBR presets + user-imported texture sets.
 * Each material: { id, name, category, color, roughness, metalness, [maps], [transparent], [emissive] }
 */

export const CATEGORIES = ['All', 'Metal', 'Stone', 'Wood', 'Fabric', 'Plastic', 'Glass', 'Emissive', 'Imported'];

export const BUILTIN = [
  // Metal
  { id: 'gold',        name: 'Gold',          category: 'Metal',    color: '#d4af37', roughness: 0.08, metalness: 1.0 },
  { id: 'silver',      name: 'Silver',        category: 'Metal',    color: '#bfc1c3', roughness: 0.12, metalness: 1.0 },
  { id: 'copper',      name: 'Copper',        category: 'Metal',    color: '#b87333', roughness: 0.22, metalness: 1.0 },
  { id: 'brass',       name: 'Brass',         category: 'Metal',    color: '#c9a227', roughness: 0.30, metalness: 1.0 },
  { id: 'chrome',      name: 'Chrome',        category: 'Metal',    color: '#d8d8d8', roughness: 0.04, metalness: 1.0 },
  { id: 'iron',        name: 'Iron',          category: 'Metal',    color: '#434343', roughness: 0.82, metalness: 0.9  },
  { id: 'rust',        name: 'Rust',          category: 'Metal',    color: '#8b3a1e', roughness: 0.95, metalness: 0.15 },
  // Stone
  { id: 'concrete',    name: 'Concrete',      category: 'Stone',    color: '#8a8c8e', roughness: 0.90, metalness: 0.0  },
  { id: 'marble',      name: 'Marble',        category: 'Stone',    color: '#e8e4de', roughness: 0.18, metalness: 0.0  },
  { id: 'granite',     name: 'Granite',       category: 'Stone',    color: '#4a4747', roughness: 0.72, metalness: 0.0  },
  { id: 'sandstone',   name: 'Sandstone',     category: 'Stone',    color: '#c8a87a', roughness: 0.88, metalness: 0.0  },
  { id: 'slate',       name: 'Slate',         category: 'Stone',    color: '#3a3e44', roughness: 0.78, metalness: 0.0  },
  // Wood
  { id: 'oak',         name: 'Oak',           category: 'Wood',     color: '#8b5e3c', roughness: 0.80, metalness: 0.0  },
  { id: 'pine',        name: 'Pine',          category: 'Wood',     color: '#d4a96a', roughness: 0.75, metalness: 0.0  },
  { id: 'dark_wood',   name: 'Dark Wood',     category: 'Wood',     color: '#3d2417', roughness: 0.70, metalness: 0.0  },
  { id: 'bamboo',      name: 'Bamboo',        category: 'Wood',     color: '#d4c576', roughness: 0.65, metalness: 0.0  },
  // Fabric
  { id: 'cotton',      name: 'Cotton',        category: 'Fabric',   color: '#e8ddd0', roughness: 1.0,  metalness: 0.0  },
  { id: 'velvet',      name: 'Velvet',        category: 'Fabric',   color: '#5c2d91', roughness: 0.95, metalness: 0.0  },
  { id: 'leather',     name: 'Leather',       category: 'Fabric',   color: '#4a2d1e', roughness: 0.60, metalness: 0.0  },
  { id: 'denim',       name: 'Denim',         category: 'Fabric',   color: '#4a6fa5', roughness: 0.92, metalness: 0.0  },
  // Plastic / Ceramic
  { id: 'plastic_wh',  name: 'White Plastic', category: 'Plastic',  color: '#f0f0f0', roughness: 0.35, metalness: 0.0  },
  { id: 'plastic_bk',  name: 'Black Plastic', category: 'Plastic',  color: '#1a1a1a', roughness: 0.30, metalness: 0.0  },
  { id: 'ceramic',     name: 'Ceramic',       category: 'Plastic',  color: '#f8f8f8', roughness: 0.08, metalness: 0.0  },
  { id: 'rubber',      name: 'Rubber',        category: 'Plastic',  color: '#1c1c1c', roughness: 0.95, metalness: 0.0  },
  // Glass
  { id: 'glass',       name: 'Glass',         category: 'Glass',    color: '#b0d8f0', roughness: 0.04, metalness: 0.0,  transparent: true, opacity: 0.28 },
  { id: 'glass_dark',  name: 'Dark Glass',    category: 'Glass',    color: '#203040', roughness: 0.06, metalness: 0.1,  transparent: true, opacity: 0.55 },
  // Emissive / Glow
  { id: 'glow_red',    name: 'Glow Red',      category: 'Emissive', color: '#ff3300', roughness: 0.5,  metalness: 0.0,  emissive: '#ff3300', emissiveIntensity: 3.0 },
  { id: 'glow_blue',   name: 'Glow Blue',     category: 'Emissive', color: '#0066ff', roughness: 0.5,  metalness: 0.0,  emissive: '#0066ff', emissiveIntensity: 3.0 },
  { id: 'glow_green',  name: 'Glow Green',    category: 'Emissive', color: '#00cc44', roughness: 0.5,  metalness: 0.0,  emissive: '#00cc44', emissiveIntensity: 3.0 },
  { id: 'neon_orange', name: 'Neon',          category: 'Emissive', color: '#ff8800', roughness: 0.5,  metalness: 0.0,  emissive: '#ff6600', emissiveIntensity: 4.0 },
];

const _imported = [];
let _nextId = 1000;

export function getAll() { return [...BUILTIN, ..._imported]; }
export function getByCategory(cat) {
  if (!cat || cat === 'All') return getAll();
  return getAll().filter(m => m.category === cat);
}
export function getById(id) { return getAll().find(m => m.id === id) ?? null; }

// ── Procedural swatch preview (lit sphere) ────────────────────────────────────

export function drawSwatch(canvas, mat) {
  const ctx = canvas.getContext('2d');
  const w   = canvas.width;
  const h   = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#13141c';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.42;
  const hex = (mat.color ?? '#808080').replace('#', '');
  const cr  = parseInt(hex.slice(0, 2), 16);
  const cg  = parseInt(hex.slice(2, 4), 16);
  const cb  = parseInt(hex.slice(4, 6), 16);

  const rough  = mat.roughness ?? 0.5;
  const metal  = mat.metalness ?? 0;
  const isGlow = !!(mat.emissive && (mat.emissiveIntensity ?? 0) > 0.5);
  const isGlas = !!mat.transparent;

  const lx = cx - r * 0.5, ly = cy - r * 0.5;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();

  if (isGlow) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,   `rgb(${Math.min(255,cr+70)},${Math.min(255,cg+70)},${Math.min(255,cb+70)})`);
    g.addColorStop(0.5, `rgb(${cr},${cg},${cb})`);
    g.addColorStop(1,   `rgb(${cr>>2},${cg>>2},${cb>>2})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  } else if (isGlas) {
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${mat.opacity ?? 0.3})`;
    ctx.fillRect(0, 0, w, h);
    const rim = ctx.createRadialGradient(cx + r*0.3, cy - r*0.3, 0, cx, cy, r);
    rim.addColorStop(0,   'rgba(255,255,255,0.55)');
    rim.addColorStop(0.4, 'rgba(255,255,255,0.08)');
    rim.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = rim; ctx.fillRect(0, 0, w, h);
  } else {
    const lum = 1 - rough * 0.55;
    const li  = Math.min(255, Math.round(cr * (1 + lum * 0.9)));
    const lg  = Math.min(255, Math.round(cg * (1 + lum * 0.9)));
    const lb  = Math.min(255, Math.round(cb * (1 + lum * 0.9)));
    const base = ctx.createRadialGradient(lx, ly, 0, cx, cy, r * 1.05);
    base.addColorStop(0,    `rgb(${li},${lg},${lb})`);
    base.addColorStop(0.55, `rgb(${cr},${cg},${cb})`);
    base.addColorStop(1,    `rgb(${cr>>3},${cg>>3},${cb>>3})`);
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);

    const specR = metal > 0.5 ? r * 0.28 : r * (1 - rough) * 0.2;
    if (specR > 1) {
      const specA = metal > 0.5 ? 0.5 + (1 - rough) * 0.4 : (1 - rough) * 0.35;
      const spec  = ctx.createRadialGradient(lx + r*0.05, ly + r*0.05, 0, lx, ly, specR * 3);
      spec.addColorStop(0, `rgba(255,255,255,${specA})`);
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec; ctx.fillRect(0, 0, w, h);
    }
  }

  // Rim darkening
  const rim2 = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
  rim2.addColorStop(0, 'rgba(0,0,0,0)');
  rim2.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = rim2; ctx.fillRect(0, 0, w, h);

  ctx.restore();

  // "T" badge for texture-set materials
  if (mat.maps) {
    ctx.fillStyle = 'rgba(108,142,247,0.9)';
    ctx.fillRect(w - 13, h - 13, 12, 12);
    ctx.fillStyle = '#fff';
    ctx.font      = `bold 8px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', w - 7, h - 7);
  }
}

// ── Import texture set ────────────────────────────────────────────────────────

const _MAP_KEYS = {
  albedo:    ['albedo','color','colour','col','diffuse','basecolor','base_color','diff','alb'],
  roughness: ['roughness','rough','rgh','gloss'],
  metalness: ['metalness','metallic','metal','mtl'],
  normal:    ['normal','nrm','nor','norm'],
  height:    ['height','displacement','disp','bump','hgt'],
  ao:        ['ao','ambientocclusion','ambient_occlusion','occlusion','occ'],
};

function _detectMap(filename) {
  const stem = filename.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/g, '');
  for (const [type, keys] of Object.entries(_MAP_KEYS)) {
    if (keys.some(k => stem.includes(k))) return type;
  }
  return null;
}

export async function importTextureSet() {
  return new Promise(resolve => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.multiple = true;
    input.accept   = 'image/*';

    input.onchange = () => {
      const files = Array.from(input.files);
      if (!files.length) { resolve(null); return; }

      const maps = {}, urls = {};
      let baseName = '';

      for (const f of files) {
        const type = _detectMap(f.name);
        if (!type) continue;
        const url  = URL.createObjectURL(f);
        maps[type] = url;
        urls[type] = url;
        if (!baseName) {
          baseName = f.name
            .replace(/[_-]?(albedo|color|col|diffuse|roughness|rough|normal|nrm|metal|metalness|height|ao)[^.]*\.[^.]+$/i, '')
            .replace(/\.[^.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .trim() || 'Imported';
        }
      }

      if (!Object.keys(maps).length) {
        alert('No recognised texture maps found.\nNaming convention: name_albedo.png, name_roughness.png, name_normal.png, …');
        resolve(null); return;
      }

      const mat = { id: `imported_${_nextId++}`, name: baseName, category: 'Imported',
                    color: '#808080', roughness: 0.5, metalness: 0.0, maps, _urls: urls };
      _imported.push(mat);
      resolve(mat);
    };

    input.click();
  });
}

export function removeImported(id) {
  const idx = _imported.findIndex(m => m.id === id);
  if (idx < 0) return;
  const mat = _imported.splice(idx, 1)[0];
  if (mat._urls) Object.values(mat._urls).forEach(u => URL.revokeObjectURL(u));
}
