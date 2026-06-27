"""
FBX → glTF/GLB on-demand converter.

Strategy: on-demand conversion using trimesh + pygltflib.
Large or complex files that trimesh cannot handle are skipped gracefully.

Usage:
    from services.converter import convert_asset
    glb_path = await convert_asset(asset_id)
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Optional

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from config import settings

try:
    import trimesh  # type: ignore
    _TRIMESH_OK = True
except ImportError:
    _TRIMESH_OK = False


def _convert_sync(fbx_path: str, glb_out: Path) -> bool:
    """
    Convert *fbx_path* to GLB at *glb_out*.
    Returns True on success, False on failure.
    """
    if not _TRIMESH_OK:
        return False

    try:
        scene = trimesh.load(fbx_path, force="scene")
        glb_out.parent.mkdir(parents=True, exist_ok=True)
        scene.export(str(glb_out))
        return glb_out.exists() and glb_out.stat().st_size > 0
    except Exception as exc:
        print(f"[converter] Failed to convert {fbx_path}: {exc}", flush=True)
        if glb_out.exists():
            glb_out.unlink(missing_ok=True)
        return False


async def convert_asset(asset_id: int) -> Optional[str]:
    """
    Convert the FBX for *asset_id* to GLB on-demand.

    Returns the relative glTF path (stored in DB) on success, None on failure.
    """
    from database.db import get_db  # lazy import

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT filepath, gltf_path FROM assets WHERE id = ?", (asset_id,)
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None

    # Already converted
    if row["gltf_path"]:
        glb_abs = settings.gltf_dir_abs / row["gltf_path"]
        if glb_abs.exists():
            return row["gltf_path"]

    fbx_path = row["filepath"]
    stem = Path(fbx_path).stem
    rel_path = f"{asset_id}_{stem}.glb"
    glb_abs = settings.gltf_dir_abs / rel_path

    # Run blocking conversion in a thread pool
    loop = asyncio.get_event_loop()
    success = await loop.run_in_executor(
        None, _convert_sync, fbx_path, glb_abs
    )

    if success:
        # Persist the path
        conn = get_db()
        try:
            conn.execute(
                "UPDATE assets SET gltf_path = ? WHERE id = ?",
                (rel_path, asset_id),
            )
            conn.commit()
        finally:
            conn.close()
        return rel_path

    return None


async def batch_convert(limit: int = 50) -> dict[str, int]:
    """
    Convert up to *limit* assets that don't yet have a glTF path.
    Returns counters dict.
    """
    from database.db import get_db

    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id FROM assets WHERE gltf_path IS NULL LIMIT ?", (limit,)
        ).fetchall()
    finally:
        conn.close()

    counters = {"attempted": 0, "converted": 0, "failed": 0}
    for row in rows:
        counters["attempted"] += 1
        result = await convert_asset(row["id"])
        if result:
            counters["converted"] += 1
        else:
            counters["failed"] += 1

    return counters
