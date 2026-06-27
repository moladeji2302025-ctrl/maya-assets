/**
 * Asset browser – category tree, search, grid rendering, drag-drop.
 */

import { dropAssetAtCursor, placeAsset, findFreePosition } from './viewer.js';
import { requestThumbnail, prioritiseThumbnail } from './thumbnail-renderer.js';

const API = 'http://localhost:8000/api';

// ── State ─────────────────────────────────────────────────────────────────────

let currentCategory = '';
let currentSearch = '';
let currentPage = 0;
const PAGE_SIZE = 80;
let totalAssets = 0;
let isListMode = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const categoryTree = document.getElementById('category-tree');
const assetGrid = document.getElementById('asset-grid');
const resultCount = document.getElementById('result-count');
const pagination = document.getElementById('pagination');
const searchInput = document.getElementById('search-input');
const catCountAll = document.getElementById('cat-count-all');

// ── Thumbnail priority observer ───────────────────────────────────────────────

const thumbObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = parseInt(entry.target.dataset.assetId2);
      if (id) prioritiseThumbnail(id);
    }
  });
}, { root: assetGrid, rootMargin: '100px' });

// ── Category tree ─────────────────────────────────────────────────────────────

const CATEGORY_ICONS = {
  'Architecture': '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'Structural': '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="4" y1="8" x2="20" y2="8"/>',
  'Doors & Windows': '<path d="M3 21h18M3 7h18M3 3h18M9 7v14M15 7v14"/>',
  'Furniture': '<path d="M20 9V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2M4 22h16M4 9h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9z"/>',
  'Lighting': '<line x1="12" y1="2" x2="12" y2="4"/><circle cx="12" cy="10" r="4"/><line x1="12" y1="16" x2="12" y2="18"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="4.22" x2="19.78" y2="5.64"/>',
  'Kitchen & Dining': '<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  'Vehicles & Transport': '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  'Food': '<path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2z"/>',
  'Apparel - Clothing': '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/>',
  'Apparel - Footwear': '<path d="M3 7c0-1.1.9-2 2-2h7l2 4H5a2 2 0 0 1-2-2zM3 7v10c0 1.1.9 2 2 2h14"/>',
  'Apparel - Bags': '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>',
  'Apparel - Headwear': '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22H7l1.523-9.11"/>',
  'Apparel - Accessories': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2"/>',
  'Food': '<path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2z"/>',
  'Miscellaneous': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};

function _catIcon(name) {
  const paths = CATEGORY_ICONS[name] || CATEGORY_ICONS['Miscellaneous'];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`;
}

async function loadCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    const cats = await res.json();
    let totalCount = 0;

    cats.forEach(cat => {
      totalCount += cat.asset_count || 0;
      const el = document.createElement('div');
      el.className = 'category-item';
      el.dataset.category = cat.name;
      el.innerHTML = `
        ${_catIcon(cat.name)}
        <span>${cat.name}</span>
        <span class="cat-count">${cat.asset_count || 0}</span>
      `;
      el.addEventListener('click', () => selectCategory(cat.name, el));
      categoryTree.appendChild(el);
    });

    if (catCountAll) catCountAll.textContent = totalCount;
  } catch {
    // Backend not reachable
  }
}

function selectCategory(name, el) {
  document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  currentCategory = name;
  currentPage = 0;
  loadAssets();
}

// ── Asset grid ────────────────────────────────────────────────────────────────

async function loadAssets() {
  assetGrid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Loading…</span></div>';

  const params = new URLSearchParams({
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
  });
  if (currentCategory) params.append('category', currentCategory);
  if (currentSearch) params.append('search', currentSearch);

  try {
    const res = await fetch(`${API}/assets?${params}`);
    const data = await res.json();
    totalAssets = data.total;
    renderAssets(data.items);
    renderPagination();
    resultCount.textContent = currentSearch
      ? `${data.items.length} results for "${currentSearch}"`
      : `${totalAssets.toLocaleString()} assets`;
  } catch {
    assetGrid.innerHTML = '<div class="loading-spinner"><span>Could not load assets. Is the backend running?</span></div>';
  }
}

function renderAssets(assets) {
  if (!assets.length) {
    assetGrid.innerHTML = '<div class="loading-spinner"><span>No assets found.</span></div>';
    return;
  }

  assetGrid.innerHTML = '';
  if (isListMode) assetGrid.classList.add('list-mode');
  else assetGrid.classList.remove('list-mode');

  assets.forEach(asset => {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.draggable = true;
    card.dataset.assetId = asset.id;
    card.dataset.assetName = asset.display_name;

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'asset-thumb';
    thumbDiv.innerHTML = `
      <div class="thumb-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      </div>`;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'asset-name';
    nameDiv.title = asset.display_name;
    nameDiv.textContent = asset.display_name;

    const addBtn = document.createElement('div');
    addBtn.className = 'add-btn';
    addBtn.title = 'Add to scene';
    addBtn.textContent = '+';

    card.appendChild(thumbDiv);
    card.appendChild(nameDiv);
    card.appendChild(addBtn);

    const placeholder = thumbDiv.querySelector('.thumb-placeholder');

    requestThumbnail(asset.id, dataUrl => {
      if (!dataUrl) return;
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = asset.display_name;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      placeholder.replaceWith(img);
    });

    // Boost priority when card scrolls into view
    thumbObserver.observe(card);
    card.dataset.assetId2 = asset.id;

    // Click to show detail
    card.addEventListener('click', e => {
      if (e.target.closest('.add-btn')) return;
      showAssetDetail(asset);
    });

    // Add button
    card.querySelector('.add-btn').addEventListener('click', e => {
      e.stopPropagation();
      addAssetToScene(asset);
    });

    // Drag
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/asset-id', asset.id);
      e.dataTransfer.setData('application/asset-name', asset.display_name);
      e.dataTransfer.effectAllowed = 'copy';
    });

    assetGrid.appendChild(card);
  });
}

function renderPagination() {
  const totalPages = Math.ceil(totalAssets / PAGE_SIZE);
  if (totalPages <= 1) { pagination.innerHTML = ''; return; }

  let html = '';
  if (currentPage > 0) html += `<button class="page-btn" data-page="${currentPage - 1}">‹</button>`;

  const start = Math.max(0, currentPage - 2);
  const end = Math.min(totalPages - 1, currentPage + 2);
  for (let p = start; p <= end; p++) {
    html += `<button class="page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p + 1}</button>`;
  }

  if (currentPage < totalPages - 1) html += `<button class="page-btn" data-page="${currentPage + 1}">›</button>`;
  html += `<span class="page-info">${currentPage + 1} / ${totalPages}</span>`;

  pagination.innerHTML = html;
  pagination.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      loadAssets();
    });
  });
}

// ── Scene placement ───────────────────────────────────────────────────────────

function addAssetToScene(asset) {
  const pos = findFreePosition();
  placeAsset(asset.id, asset.display_name, pos);
  updateStatus();
}

function updateStatus() {
  import('./scene-manager.js').then(({ sceneManager }) => {
    const right = document.getElementById('status-right');
    if (right) right.textContent = `${sceneManager.count} asset${sceneManager.count !== 1 ? 's' : ''} in scene`;
  });
}

// ── Asset detail modal ────────────────────────────────────────────────────────

function showAssetDetail(asset) {
  document.getElementById('detail-name').textContent = asset.display_name;
  document.getElementById('detail-category').textContent = asset.category || '–';

  // Thumbnail in modal
  const preview = document.getElementById('detail-preview');
  preview.innerHTML = `
    <div class="thumb-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-active);border-radius:var(--radius-sm)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;opacity:.3">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    </div>`;
  requestThumbnail(asset.id, dataUrl => {
    if (!dataUrl) return;
    preview.innerHTML = `<img src="${dataUrl}" alt="${asset.display_name}" style="width:100%;height:100%;object-fit:contain;border-radius:var(--radius-sm)">`;
  });
  document.getElementById('detail-filename').textContent = asset.filename || '–';

  const size = asset.file_size
    ? asset.file_size > 1024 * 1024
      ? `${(asset.file_size / 1024 / 1024).toFixed(1)} MB`
      : `${(asset.file_size / 1024).toFixed(0)} KB`
    : '–';
  document.getElementById('detail-filesize').textContent = size;
  document.getElementById('detail-polycount').textContent = asset.poly_count
    ? asset.poly_count.toLocaleString()
    : '–';

  const dims = (asset.bbox_width && asset.bbox_height && asset.bbox_depth)
    ? `${asset.bbox_width.toFixed(2)} × ${asset.bbox_height.toFixed(2)} × ${asset.bbox_depth.toFixed(2)}`
    : '–';
  document.getElementById('detail-dims').textContent = dims;

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = (asset.tags || [])
    .map(t => `<span class="detail-tag">${t}</span>`)
    .join('');

  document.getElementById('btn-detail-add').onclick = () => {
    addAssetToScene(asset);
    document.getElementById('modal-asset-detail').style.display = 'none';
  };

  document.getElementById('btn-detail-convert').onclick = async () => {
    const btn = document.getElementById('btn-detail-convert');
    btn.textContent = 'Converting…';
    btn.disabled = true;
    await fetch(`${API}/assets/${asset.id}/gltf`).catch(() => null);
    btn.textContent = 'Done';
    setTimeout(() => { btn.textContent = 'Convert to glTF'; btn.disabled = false; }, 2000);
  };

  document.getElementById('modal-asset-detail').style.display = 'flex';
}

// ── Drag onto viewport ────────────────────────────────────────────────────────

const viewportContainer = document.getElementById('viewport-container');
const dropOverlay = document.getElementById('drop-overlay');

viewportContainer.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropOverlay.classList.add('active');
});

viewportContainer.addEventListener('dragleave', () => {
  dropOverlay.classList.remove('active');
});

viewportContainer.addEventListener('drop', async e => {
  e.preventDefault();
  dropOverlay.classList.remove('active');
  const assetId = e.dataTransfer.getData('application/asset-id');
  const assetName = e.dataTransfer.getData('application/asset-name');
  if (!assetId) return;
  await dropAssetAtCursor(parseInt(assetId), assetName, e.clientX, e.clientY);
  updateStatus();
});

// ── Search ────────────────────────────────────────────────────────────────────

let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = searchInput.value.trim();
    currentPage = 0;
    loadAssets();
  }, 350);
});

// ── View toggle ───────────────────────────────────────────────────────────────

document.getElementById('btn-grid-view').addEventListener('click', () => {
  isListMode = false;
  document.getElementById('btn-grid-view').classList.add('active');
  document.getElementById('btn-list-view').classList.remove('active');
  renderAssets([]); // reload with mode
  loadAssets();
});

document.getElementById('btn-list-view').addEventListener('click', () => {
  isListMode = true;
  document.getElementById('btn-list-view').classList.add('active');
  document.getElementById('btn-grid-view').classList.remove('active');
  loadAssets();
});

// ── Keyboard ─────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

// "All Assets" click
document.querySelector('.category-item[data-category=""]').addEventListener('click', e => {
  selectCategory('', e.currentTarget);
});

await loadCategories();
await loadAssets();

export { loadAssets, showAssetDetail };
