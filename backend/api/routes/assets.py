"""
Asset CRUD + search endpoints.
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from config import settings
from database.db import get_db, dict_from_row

router = APIRouter()


def _asset_row_to_dict(row) -> dict:
    d = dict_from_row(row)
    # Parse JSON tags field
    try:
        d["tags"] = json.loads(d.get("tags") or "[]")
    except (json.JSONDecodeError, TypeError):
        d["tags"] = []
    return d


@router.get("")
def list_assets(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List assets with optional category filter and full-text search."""
    conn = get_db()
    try:
        if search:
            # Use FTS5 for full-text search
            rows = conn.execute(
                """
                SELECT a.*
                FROM assets a
                JOIN assets_fts f ON f.rowid = a.id
                WHERE assets_fts MATCH ?
                  AND (? IS NULL OR a.category = ?)
                ORDER BY rank
                LIMIT ? OFFSET ?
                """,
                (search, category, category, limit, offset),
            ).fetchall()
        elif category:
            rows = conn.execute(
                "SELECT * FROM assets WHERE category = ? ORDER BY display_name LIMIT ? OFFSET ?",
                (category, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM assets ORDER BY display_name LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()

        total = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        return {
            "items": [_asset_row_to_dict(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    finally:
        conn.close()


@router.get("/count")
def count_assets(category: Optional[str] = Query(None)):
    conn = get_db()
    try:
        if category:
            n = conn.execute(
                "SELECT COUNT(*) FROM assets WHERE category = ?", (category,)
            ).fetchone()[0]
        else:
            n = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        return {"count": n}
    finally:
        conn.close()


@router.get("/{asset_id}")
def get_asset(asset_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Asset not found")
        return _asset_row_to_dict(row)
    finally:
        conn.close()


@router.get("/{asset_id}/thumbnail")
def get_thumbnail(asset_id: int):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT thumbnail_path FROM assets WHERE id = ?", (asset_id,)
        ).fetchone()
    finally:
        conn.close()

    if not row or not row["thumbnail_path"]:
        raise HTTPException(status_code=404, detail="Thumbnail not available")

    thumb_path = settings.thumbnail_dir_abs / row["thumbnail_path"]
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file missing")

    return FileResponse(str(thumb_path), media_type="image/png")


@router.get("/{asset_id}/fbx")
def get_fbx(asset_id: int):
    """Serve the original FBX file for direct browser loading via Three.js FBXLoader."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT filepath FROM assets WHERE id = ?", (asset_id,)
        ).fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")

    from pathlib import Path as _Path
    fbx_path = _Path(row["filepath"])
    if not fbx_path.exists():
        raise HTTPException(status_code=404, detail="FBX file not found on disk")

    return FileResponse(str(fbx_path), media_type="application/octet-stream",
                        filename=fbx_path.name)


@router.get("/{asset_id}/gltf")
async def get_gltf(asset_id: int):
    from services.converter import convert_asset
    rel_path = await convert_asset(asset_id)
    if not rel_path:
        raise HTTPException(status_code=404, detail="glTF not available")
    gltf_path = settings.gltf_dir_abs / rel_path
    if not gltf_path.exists():
        raise HTTPException(status_code=404, detail="glTF file missing")
    return FileResponse(str(gltf_path), media_type="model/gltf-binary")
