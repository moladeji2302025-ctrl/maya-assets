-- Maya Asset Library – SQLite schema
-- Encoding: UTF-8

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Categories
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    parent_id   INTEGER REFERENCES categories(id),
    icon        TEXT,
    description TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Assets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filename       TEXT    NOT NULL,
    filepath       TEXT    NOT NULL UNIQUE,
    display_name   TEXT    NOT NULL,
    category       TEXT,
    subcategory    TEXT,
    tags           TEXT    DEFAULT '[]',   -- JSON array
    file_size      INTEGER,
    thumbnail_path TEXT,
    gltf_path      TEXT,
    bbox_width     REAL,
    bbox_height    REAL,
    bbox_depth     REAL,
    poly_count     INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Scene sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scene_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    prompt      TEXT,
    layout_json TEXT    DEFAULT '{}',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Scene → Asset placement records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scene_assets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES scene_sessions(id) ON DELETE CASCADE,
    asset_id    INTEGER NOT NULL REFERENCES assets(id),
    position_x  REAL DEFAULT 0,
    position_y  REAL DEFAULT 0,
    position_z  REAL DEFAULT 0,
    rotation_x  REAL DEFAULT 0,
    rotation_y  REAL DEFAULT 0,
    rotation_z  REAL DEFAULT 0,
    scale_x     REAL DEFAULT 1,
    scale_y     REAL DEFAULT 1,
    scale_z     REAL DEFAULT 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_assets_category     ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_display_name ON assets(display_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- Full-text search (FTS5)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
    display_name,
    category,
    subcategory,
    tags,
    content=assets,
    content_rowid=id
);

-- FTS sync triggers
CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN
    INSERT INTO assets_fts(rowid, display_name, category, subcategory, tags)
    VALUES (new.id, new.display_name, new.category, new.subcategory, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN
    INSERT INTO assets_fts(assets_fts, rowid, display_name, category, subcategory, tags)
    VALUES ('delete', old.id, old.display_name, old.category, old.subcategory, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE ON assets BEGIN
    INSERT INTO assets_fts(assets_fts, rowid, display_name, category, subcategory, tags)
    VALUES ('delete', old.id, old.display_name, old.category, old.subcategory, old.tags);
    INSERT INTO assets_fts(rowid, display_name, category, subcategory, tags)
    VALUES (new.id, new.display_name, new.category, new.subcategory, new.tags);
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed categories (27)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO categories (name) VALUES
    ('Architecture'),
    ('Structural'),
    ('Doors & Windows'),
    ('Furniture'),
    ('Lighting'),
    ('Kitchen & Dining'),
    ('Exterior & Landscape'),
    ('Vehicles & Transport'),
    ('Vehicle Parts'),
    ('Apparel - Clothing'),
    ('Apparel - Footwear'),
    ('Apparel - Bags'),
    ('Apparel - Headwear'),
    ('Apparel - Accessories'),
    ('Apparel - Fasteners'),
    ('Food'),
    ('Drinks & Bottles'),
    ('Candy & Snacks'),
    ('Camping & Outdoor'),
    ('Military & Tactical'),
    ('Hardware & Mechanical'),
    ('Sci-Fi & Covers'),
    ('Ancient & Historical'),
    ('Decor & Ornaments'),
    ('Interiors'),
    ('Medical'),
    ('Miscellaneous');
