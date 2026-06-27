/**
 * Scene Manager – tracks placed assets, handles undo/redo, serialises state.
 * Exported as a singleton consumed by viewer.js and ai-assistant.js.
 */

const MAX_UNDO = 50;

class SceneManager extends EventTarget {
  constructor() {
    super();
    this._items = [];       // [{id, assetId, name, position, rotation, scale, meshUuid}]
    this._selected = null;  // item id
    this._undoStack = [];
    this._redoStack = [];
    this._nextId = 1;
  }

  get items() { return this._items; }
  get selectedId() { return this._selected; }
  get count() { return this._items.length; }
  get canUndo() { return this._undoStack.length > 0; }

  // ── Snapshot helpers ────────────────────────────────────────────────────────

  _snapshot() {
    return JSON.parse(JSON.stringify(this._items));
  }

  _push(snapshot) {
    this._undoStack.push(snapshot);
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
    this._redoStack = [];
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  addItem(assetId, name, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1.0, meshUuid = null) {
    this._push(this._snapshot());
    const item = {
      id: this._nextId++,
      assetId,
      name,
      position: [...position],
      rotation: [...rotation],
      scale,
      meshUuid,
    };
    this._items.push(item);
    this._emit('add', { item });
    this._emit('change');
    return item;
  }

  updateItem(id, patch) {
    const item = this._items.find(i => i.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this._emit('update', { item });
    this._emit('change');
  }

  // Call before a drag/transform starts; call commitMove() when it ends.
  beginMove() {
    this._preMoveSnapshot = this._snapshot();
  }

  commitMove() {
    if (this._preMoveSnapshot) {
      this._push(this._preMoveSnapshot);
      this._preMoveSnapshot = null;
    }
  }

  removeItem(id) {
    const idx = this._items.findIndex(i => i.id === id);
    if (idx === -1) return;
    this._push(this._snapshot());
    const [removed] = this._items.splice(idx, 1);
    if (this._selected === id) this._selected = null;
    this._emit('remove', { item: removed });
    this._emit('change');
  }

  clearAll() {
    if (!this._items.length) return;
    this._push(this._snapshot());
    const removed = [...this._items];
    this._items = [];
    this._selected = null;
    removed.forEach(item => this._emit('remove', { item }));
    this._emit('change');
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  select(id) {
    if (this._selected === id) return;
    const prev = this._selected;
    this._selected = id;
    this._emit('selectionChange', { prev, next: id });
  }

  deselect() { this.select(null); }

  getSelected() { return this._items.find(i => i.id === this._selected) || null; }

  // ── Undo / Redo ──────────────────────────────────────────────────────────────

  undo() {
    if (!this._undoStack.length) return;
    this._redoStack.push(this._snapshot());
    this._restoreSnapshot(this._undoStack.pop());
  }

  redo() {
    if (!this._redoStack.length) return;
    this._undoStack.push(this._snapshot());
    this._restoreSnapshot(this._redoStack.pop());
  }

  _restoreSnapshot(snapshot) {
    const prevItems = this._items;
    this._items = snapshot;
    this._selected = null;

    prevItems.forEach(prev => {
      if (!snapshot.find(s => s.id === prev.id)) this._emit('remove', { item: prev });
    });
    snapshot.forEach(item => {
      if (!prevItems.find(p => p.id === item.id)) this._emit('add', { item });
      else this._emit('update', { item });
    });

    this._emit('change');
  }

  // ── Serialisation ────────────────────────────────────────────────────────────

  toJSON() {
    return {
      assets: this._items.map(i => ({
        item_id: i.id,
        asset_id: i.assetId,
        display_name: i.name,
        position: i.position,
        rotation: i.rotation,
        scale: i.scale,
      })),
    };
  }

  loadJSON(layout) {
    this.clearAll();
    (layout.assets || []).forEach(a => {
      this.addItem(a.asset_id, a.display_name, a.position, a.rotation, a.scale);
    });
  }

  // ── Internal event helpers ───────────────────────────────────────────────────

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const sceneManager = new SceneManager();
