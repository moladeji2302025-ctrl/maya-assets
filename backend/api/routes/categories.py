"""
Category tree endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from database.db import get_db, dict_from_row

router = APIRouter()


@router.get("")
def list_categories():
    """Return all categories with asset counts."""
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT c.id, c.name, c.parent_id, c.icon, c.description,
                   COUNT(a.id) as asset_count
            FROM categories c
            LEFT JOIN assets a ON a.category = c.name
            GROUP BY c.id
            ORDER BY c.name
            """
        ).fetchall()
        return [dict_from_row(r) for r in rows]
    finally:
        conn.close()


@router.get("/{category_id}")
def get_category(category_id: int):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM categories WHERE id = ?", (category_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Category not found")
        return dict_from_row(row)
    finally:
        conn.close()
