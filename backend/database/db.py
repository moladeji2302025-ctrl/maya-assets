"""
SQLite connection manager for Maya Asset Library.

Usage:
    from database.db import get_db, init_db, dict_from_row
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from config import settings

# ─── Resolved DB path ────────────────────────────────────────────────────────
DB_PATH: Path = settings.db_path_abs

_SCHEMA_PATH: Path = Path(__file__).with_name("schema.sql")


# ─── Public helpers ───────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    """
    Open and return a SQLite connection.

    Features:
    - row_factory = sqlite3.Row  (column-name access)
    - WAL journal mode           (concurrent reads while writing)
    - foreign keys enforced
    - 30 s busy timeout          (avoids "database is locked" under light concurrency)
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row

    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA synchronous = NORMAL;")  # safe with WAL
    conn.commit()

    return conn


def init_db() -> None:
    """
    Read schema.sql and execute it against the configured database.

    Safe to call on every startup — all DDL statements use IF NOT EXISTS.
    """
    schema_sql = _SCHEMA_PATH.read_text(encoding="utf-8")
    conn = get_db()
    try:
        # executescript commits automatically before running; that's fine here.
        conn.executescript(schema_sql)
        conn.commit()
    finally:
        conn.close()


def dict_from_row(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(zip(row.keys(), tuple(row)))
