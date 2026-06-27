"""
Thumbnail generator for asset preview images.

Strategy: render a simple top-down orthographic projection of the mesh
using trimesh's built-in renderer (OffscreenRenderer via pyopengl or software),
then crop/resize to MAX_THUMBNAIL_SIZE.

If trimesh rendering is unavailable, a placeholder gray image is saved.

Usage:
    from services.thumbnail_generator import generate_thumbnail
    thumb_path = await generate_thumbnail(asset_id)
"""

from __future__ import annotations

import asyncio
import sys
from io import BytesIO
from pathlib import Path
from typing import Optional

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from config import settings

try:
    from PIL import Image, ImageDraw  # type: ignore
    _PIL_OK = True
except ImportError:
    _PIL_OK = False

try:
    import trimesh  # type: ignore
    _TRIMESH_OK = True
except ImportError:
    _TRIMESH_OK = False


def _make_placeholder(out_path: Path) -> bool:
    if not _PIL_OK:
        return False
    size = settings.MAX_THUMBNAIL_SIZE
    img = Image.new("RGB", size, color=(40, 40, 48))
    draw = ImageDraw.Draw(img)
    # Simple 3D box icon
    cx, cy = size[0] // 2, size[1] // 2
    s = min(size) // 3
    draw.rectangle([cx - s, cy - s, cx + s, cy + s], outline=(100, 120, 200), width=2)
    draw.line([cx - s, cy - s, cx - s // 2, cy - s - s // 3], fill=(100, 120, 200), width=2)
    draw.line([cx + s, cy - s, cx + s + s // 2, cy - s - s // 3], fill=(100, 120, 200), width=2)
    draw.line([cx - s // 2, cy - s - s // 3, cx + s + s // 2, cy - s - s // 3], fill=(100, 120, 200), width=2)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(out_path), format="PNG")
    return True


def _render_sync(fbx_path: str, out_path: Path) -> bool:
    """
    Attempt to render a thumbnail.  Falls back to placeholder on any error.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not _TRIMESH_OK or not _PIL_OK:
        return _make_placeholder(out_path)

    try:
        scene = trimesh.load(fbx_path, force="scene")

        # Collect meshes
        meshes = []
        if isinstance(scene, trimesh.Scene):
            meshes = list(scene.geometry.values())
        elif isinstance(scene, trimesh.Trimesh):
            meshes = [scene]

        if not meshes:
            return _make_placeholder(out_path)

        # Build a minimal scene for rendering
        if not isinstance(scene, trimesh.Scene):
            scene = trimesh.Scene(meshes[0])

        # Try offscreen PNG render (requires pyopengl or osmesa)
        try:
            png_bytes = scene.save_image(resolution=settings.MAX_THUMBNAIL_SIZE, visible=True)
            img = Image.open(BytesIO(png_bytes)).convert("RGB")
            img = img.resize(settings.MAX_THUMBNAIL_SIZE, Image.LANCZOS)
            img.save(str(out_path), format="PNG")
            return True
        except Exception:
            pass

        # Software fallback — project vertices onto 2D
        import numpy as np  # trimesh dep

        all_verts = []
        for m in meshes:
            if hasattr(m, "vertices"):
                all_verts.append(m.vertices)
        if not all_verts:
            return _make_placeholder(out_path)

        verts = np.vstack(all_verts)

        # Normalise to [10, 246] range for a 256x256 image
        v2d = verts[:, [0, 2]]  # top-down: X and Z
        mn, mx = v2d.min(0), v2d.max(0)
        rng = mx - mn
        rng[rng == 0] = 1
        v2d = (v2d - mn) / rng * 236 + 10

        size = settings.MAX_THUMBNAIL_SIZE
        img = Image.new("RGB", size, color=(30, 30, 38))
        draw = ImageDraw.Draw(img)

        pts = [(float(x), float(y)) for x, y in v2d[:2000]]  # max 2k dots
        for x, y in pts:
            draw.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(100, 160, 255))

        img.save(str(out_path), format="PNG")
        return True

    except Exception:
        return _make_placeholder(out_path)


async def generate_thumbnail(asset_id: int) -> Optional[str]:
    """
    Generate (or return cached) thumbnail for *asset_id*.
    Returns the relative thumbnail path on success, None on failure.
    """
    from database.db import get_db

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT filepath, thumbnail_path FROM assets WHERE id = ?", (asset_id,)
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None

    # Already generated
    if row["thumbnail_path"]:
        thumb_abs = settings.thumbnail_dir_abs / row["thumbnail_path"]
        if thumb_abs.exists():
            return row["thumbnail_path"]

    fbx_path = row["filepath"]
    rel_path = f"{asset_id}.png"
    thumb_abs = settings.thumbnail_dir_abs / rel_path

    loop = asyncio.get_event_loop()
    success = await loop.run_in_executor(None, _render_sync, fbx_path, thumb_abs)

    if success:
        conn = get_db()
        try:
            conn.execute(
                "UPDATE assets SET thumbnail_path = ? WHERE id = ?",
                (rel_path, asset_id),
            )
            conn.commit()
        finally:
            conn.close()
        return rel_path

    return None


async def batch_generate(limit: int = 100) -> dict[str, int]:
    """Generate thumbnails for up to *limit* assets missing them."""
    from database.db import get_db

    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id FROM assets WHERE thumbnail_path IS NULL LIMIT ?", (limit,)
        ).fetchall()
    finally:
        conn.close()

    counters = {"attempted": 0, "generated": 0, "failed": 0}
    for row in rows:
        counters["attempted"] += 1
        result = await generate_thumbnail(row["id"])
        if result:
            counters["generated"] += 1
        else:
            counters["failed"] += 1

    return counters
