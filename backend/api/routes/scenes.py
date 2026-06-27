"""
Scene session save / load / sync endpoints.
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database.db import get_db, dict_from_row

router = APIRouter()


# ── Pydantic models ───────────────────────────────────────────────────────────

class SceneCreate(BaseModel):
    name: str
    prompt: Optional[str] = None
    layout_json: Optional[dict] = None


class SceneUpdate(BaseModel):
    name: Optional[str] = None
    layout_json: Optional[dict] = None


class SyncPayload(BaseModel):
    nodes: list[dict]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_scenes():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM scene_sessions ORDER BY created_at DESC"
        ).fetchall()
        result = []
        for r in rows:
            d = dict_from_row(r)
            try:
                d["layout_json"] = json.loads(d.get("layout_json") or "{}")
            except (json.JSONDecodeError, TypeError):
                d["layout_json"] = {}
            result.append(d)
        return result
    finally:
        conn.close()


@router.post("")
def create_scene(body: SceneCreate):
    conn = get_db()
    try:
        layout_str = json.dumps(body.layout_json or {})
        cur = conn.execute(
            "INSERT INTO scene_sessions (name, prompt, layout_json) VALUES (?, ?, ?)",
            (body.name, body.prompt, layout_str),
        )
        conn.commit()
        scene_id = cur.lastrowid
        row = conn.execute(
            "SELECT * FROM scene_sessions WHERE id = ?", (scene_id,)
        ).fetchone()
        return dict_from_row(row)
    finally:
        conn.close()


@router.get("/{scene_id}")
def get_scene(scene_id: int):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM scene_sessions WHERE id = ?", (scene_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scene not found")
        d = dict_from_row(row)
        try:
            d["layout_json"] = json.loads(d.get("layout_json") or "{}")
        except (json.JSONDecodeError, TypeError):
            d["layout_json"] = {}
        return d
    finally:
        conn.close()


@router.put("/{scene_id}")
def update_scene(scene_id: int, body: SceneUpdate):
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM scene_sessions WHERE id = ?", (scene_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Scene not found")

        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.layout_json is not None:
            updates["layout_json"] = json.dumps(body.layout_json)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE scene_sessions SET {set_clause} WHERE id = ?",
                (*updates.values(), scene_id),
            )
            conn.commit()

        row = conn.execute(
            "SELECT * FROM scene_sessions WHERE id = ?", (scene_id,)
        ).fetchone()
        return dict_from_row(row)
    finally:
        conn.close()


@router.delete("/{scene_id}")
def delete_scene(scene_id: int):
    conn = get_db()
    try:
        conn.execute("DELETE FROM scene_sessions WHERE id = ?", (scene_id,))
        conn.commit()
        return {"deleted": scene_id}
    finally:
        conn.close()


@router.post("/sync")
def sync_scene(body: SyncPayload):
    """Receive Maya scene state from the plugin for preview sync."""
    return {"synced": len(body.nodes), "nodes": body.nodes}


# ── Maya export ───────────────────────────────────────────────────────────────

class MayaExportRequest(BaseModel):
    scene: dict
    scene_name: str = "Scene"


@router.post("/export/maya")
def export_maya_script(body: MayaExportRequest):
    """
    Generate a Maya Python script that re-imports every original FBX
    at the correct world position/rotation/scale.

    Coordinate conversion:
      Three.js stores positions in metres (CM_TO_M applied at load time).
      Maya default units are centimetres → multiply positions by 100.
      Rotation (degrees) and user-applied scale are passed through unchanged.
    """
    from datetime import datetime, timezone
    from fastapi.responses import Response

    conn = get_db()
    try:
        now    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        name   = body.scene_name
        assets = body.scene.get("assets", [])

        lines = [
            "# ════════════════════════════════════════════════════════════════════",
            f"# Maya Asset Library — Scene Export",
            f"# Scene : {name}",
            f"# Built : {now}",
            "# ────────────────────────────────────────────────────────────────────",
            "# HOW TO USE",
            "#   1. Open Maya",
            "#   2. Open the Script Editor  (Windows > General Editors > Script Editor)",
            "#   3. Paste this entire script into the Python tab",
            "#   4. Press Ctrl+Enter (or the Run button)",
            "# ────────────────────────────────────────────────────────────────────",
            "# NOTE: Asset file paths are absolute from the machine that generated",
            "#       this script.  If you're on a different machine, update the",
            "#       paths or set the asset_root variable at the bottom.",
            "# ════════════════════════════════════════════════════════════════════",
            "",
            "import maya.cmds as mc",
            "",
            "",
            "def _import_and_place(file_path, obj_name, tx, ty, tz, rx, ry, rz, s):",
            "    \"\"\"Import one FBX and place it at (tx,ty,tz) cm with the given rotation/scale.\"\"\"",
            "    before = set(mc.ls(type='transform', long=True) or [])",
            "    mc.file(file_path, i=True, type='FBX', options='v=0',",
            "            ra=True, mergeNamespacesOnClash=False)",
            "    after  = set(mc.ls(type='transform', long=True) or [])",
            "    new    = after - before",
            "    # Find root-level transforms (no parent among the new nodes)",
            "    roots  = [n for n in new",
            "              if not (mc.listRelatives(n, parent=True) or [])]",
            "    if not roots:",
            "        print(f'[MAL] WARNING: no root transform found for {obj_name}')",
            "        return None",
            "    grp = roots[0] if len(roots) == 1 else mc.group(*roots, world=True)",
            "    mc.xform(grp, centerPivots=True)   # match Three.js bbox-centre pivot",
            "    grp = mc.rename(grp, obj_name)",
            "    mc.move(tx, ty, tz, grp, worldSpace=True)",
            "    mc.rotate(rx, ry, rz, grp, worldSpace=True)",
            "    mc.scale(s, s, s, grp)",
            "    print(f'[MAL] Placed: {grp}  at ({tx:.1f}, {ty:.1f}, {tz:.1f}) cm')",
            "    return grp",
            "",
            "",
            "# ── Scene assets ─────────────────────────────────────────────────────────────",
        ]

        name_counts: dict[str, int] = {}

        for item in assets:
            asset_id = item.get("asset_id")
            if not asset_id:
                continue

            row = conn.execute(
                "SELECT file_path, display_name FROM assets WHERE id = ?",
                (asset_id,),
            ).fetchone()
            if not row:
                lines.append(f"# SKIPPED item_id={item.get('item_id')} — asset {asset_id} not found in catalog")
                continue

            file_path    = row["file_path"].replace("\\", "/")
            display_name = item.get("display_name") or row["display_name"]

            # Sanitise into a valid Maya identifier
            safe = "".join(c if c.isalnum() else "_" for c in display_name).strip("_")
            if safe and safe[0].isdigit():
                safe = "_" + safe
            safe = safe or "Asset"

            count = name_counts.get(safe, 0) + 1
            name_counts[safe] = count
            obj_name = f"{safe}_{count:03d}"

            pos   = item.get("position", [0, 0, 0])
            rot   = item.get("rotation", [0, 0, 0])
            scale = item.get("scale", 1.0)

            # Three.js metres → Maya centimetres
            tx, ty, tz = pos[0] * 100, pos[1] * 100, pos[2] * 100
            rx, ry, rz = rot[0], rot[1], rot[2]

            lines.append(
                f'_import_and_place(r"{file_path}", "{obj_name}", '
                f"{tx:.3f}, {ty:.3f}, {tz:.3f}, "
                f"{rx:.3f}, {ry:.3f}, {rz:.3f}, "
                f"{scale:.4f})"
            )

        script   = "\n".join(lines) + "\n"
        filename = name.replace(" ", "_") + "_maya.py"

        return Response(
            content=script,
            media_type="text/x-python",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        conn.close()
