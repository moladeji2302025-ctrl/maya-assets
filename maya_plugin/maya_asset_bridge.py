"""
Maya Asset Bridge Plugin
Provides functions to import FBX assets from the web app into Maya
and sync scene state back to the web app.

Usage:
    import maya_asset_bridge as mab
    mab.import_asset("E:/Assets/file.fbx", position=(0,0,0), rotation=(0,90,0), scale=1.0)
    mab.apply_layout(layout_json)
"""

import maya.cmds as cmds
import json
import os
import requests  # Maya Python 3 has requests available

BASE_URL = "http://localhost:8000/api"

# Default Maya nodes to exclude when listing scene transforms
_DEFAULT_NODES = frozenset([
    "persp", "top", "front", "side",
    "perspShape", "topShape", "frontShape", "sideShape",
])

# Tracks which root nodes were imported by this bridge so we can clear them later
_imported_nodes: list[str] = []


def import_asset(
    asset_path: str,
    position: tuple = (0, 0, 0),
    rotation: tuple = (0, 0, 0),
    scale: float = 1.0,
    name: str | None = None,
) -> str:
    """
    Import an FBX file into the current Maya scene.

    Parameters
    ----------
    asset_path : str
        Absolute path to the .fbx file on disk.
    position : tuple
        World-space translation (x, y, z).
    rotation : tuple
        World-space rotation in degrees (x, y, z).
    scale : float
        Uniform world-space scale.
    name : str, optional
        Desired root-node name.  Maya may append a numeric suffix if the
        name is already taken.

    Returns
    -------
    str
        The name of the imported root transform node as it exists in Maya.

    Raises
    ------
    FileNotFoundError
        If *asset_path* does not exist on disk.
    RuntimeError
        If the FBX import fails or no new root node is found.
    """
    asset_path = os.path.normpath(asset_path)
    if not os.path.isfile(asset_path):
        raise FileNotFoundError(f"Asset not found: {asset_path}")

    # Snapshot of top-level transforms before import
    before = set(cmds.ls(assemblies=True) or [])

    try:
        cmds.file(
            asset_path,
            i=True,
            type="FBX",
            ignoreVersion=True,
            mergeNamespacesOnClash=False,
            namespace=":",          # import into root namespace
            options="fbx",
            importTimeRange="none",
            preserveReferences=False,
        )
    except Exception as exc:
        raise RuntimeError(f"FBX import failed for '{asset_path}': {exc}") from exc

    # Find newly added assemblies
    after = set(cmds.ls(assemblies=True) or [])
    new_nodes = list(after - before)

    if not new_nodes:
        raise RuntimeError(
            f"Import appeared to succeed but no new root nodes were found "
            f"after importing '{asset_path}'."
        )

    # Maya may import multiple roots; pick the first (most common case).
    root_node = new_nodes[0]

    # Rename if requested
    if name:
        try:
            root_node = cmds.rename(root_node, name)
        except Exception:
            pass  # name collision — keep Maya's auto-name

    # Apply world-space transforms
    cmds.xform(root_node, worldSpace=True, translation=list(position))
    cmds.xform(root_node, worldSpace=True, rotation=list(rotation))
    cmds.xform(root_node, worldSpace=True, scale=[scale, scale, scale])

    # Remember for clear_imported_assets()
    _imported_nodes.append(root_node)

    return root_node


def get_scene_state() -> list[dict]:
    """
    Return a list of all user-added transform nodes in the scene with their
    world-space transforms.

    Each entry is a dict with keys:
        name        — Maya node name
        position    — [x, y, z] world translation
        rotation    — [x, y, z] world rotation (degrees)
        scale       — [x, y, z] world scale
        asset_path  — value of the "assetPath" string attribute if it exists,
                      otherwise an empty string
    """
    all_transforms = cmds.ls(type="transform") or []

    state: list[dict] = []
    for node in all_transforms:
        # Skip default cameras / lights
        if node in _DEFAULT_NODES:
            continue
        # Skip shape-only intermediate objects
        if not cmds.objExists(node):
            continue

        try:
            pos = cmds.xform(node, query=True, worldSpace=True, translation=True)
            rot = cmds.xform(node, query=True, worldSpace=True, rotation=True)
            scl = cmds.xform(node, query=True, worldSpace=True, scale=True)
        except Exception:
            continue  # node may have been deleted concurrently

        # Read custom "assetPath" attribute if it was stamped on import
        asset_path = ""
        if cmds.attributeQuery("assetPath", node=node, exists=True):
            try:
                asset_path = cmds.getAttr(f"{node}.assetPath") or ""
            except Exception:
                pass

        state.append(
            {
                "name": node,
                "position": list(pos),
                "rotation": list(rot),
                "scale": list(scl),
                "asset_path": asset_path,
            }
        )

    return state


def apply_layout(layout_json: dict):
    """
    Apply a scene layout from the AI composer.

    Parameters
    ----------
    layout_json : dict
        Expected shape::

            {
                "assets": [
                    {
                        "asset_id": int,
                        "display_name": str,
                        "position": [x, y, z],
                        "rotation": [x, y, z],
                        "scale": float
                    },
                    ...
                ]
            }

    For each asset spec the function fetches ``GET /api/assets/{asset_id}``
    to resolve the file path, then calls :func:`import_asset`.

    Raises
    ------
    requests.HTTPError
        If a GET /api/assets/{id} call returns a non-2xx status.
    RuntimeError
        If the API response does not contain a usable file path.
    """
    assets = layout_json.get("assets", [])
    if not assets:
        cmds.warning("apply_layout: layout_json contains no assets.")
        return

    errors: list[str] = []

    for spec in assets:
        asset_id = spec.get("asset_id")
        display_name = spec.get("display_name", f"asset_{asset_id}")
        position = tuple(spec.get("position", [0, 0, 0]))
        rotation = tuple(spec.get("rotation", [0, 0, 0]))
        scale = float(spec.get("scale", 1.0))

        # ------------------------------------------------------------------
        # Fetch asset metadata from the web app
        # ------------------------------------------------------------------
        try:
            resp = requests.get(f"{BASE_URL}/assets/{asset_id}", timeout=10)
            resp.raise_for_status()
        except requests.RequestException as exc:
            msg = f"Failed to fetch asset {asset_id}: {exc}"
            cmds.warning(msg)
            errors.append(msg)
            continue

        asset_data = resp.json()

        # The backend may return the path under several key names
        file_path = (
            asset_data.get("file_path")
            or asset_data.get("filepath")
            or asset_data.get("path")
            or ""
        )

        if not file_path:
            msg = (
                f"Asset {asset_id} response contains no file path. "
                f"Response keys: {list(asset_data.keys())}"
            )
            cmds.warning(msg)
            errors.append(msg)
            continue

        # ------------------------------------------------------------------
        # Import into Maya
        # ------------------------------------------------------------------
        try:
            node = import_asset(
                file_path,
                position=position,
                rotation=rotation,
                scale=scale,
                name=display_name,
            )
            print(f"[maya_asset_bridge] Imported '{display_name}' as '{node}'")
        except Exception as exc:
            msg = f"Failed to import asset {asset_id} ('{display_name}'): {exc}"
            cmds.warning(msg)
            errors.append(msg)

    if errors:
        cmds.warning(
            f"apply_layout finished with {len(errors)} error(s). "
            "Check the Script Editor for details."
        )


def sync_to_web():
    """
    Send the current Maya scene state to the web app for preview sync.

    Makes a ``POST /api/scenes/sync`` request with the full scene state as
    JSON.  Prints a confirmation or warning to Maya's output.
    """
    state = get_scene_state()
    payload = {"nodes": state}

    try:
        resp = requests.post(
            f"{BASE_URL}/scenes/sync",
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        print(
            f"[maya_asset_bridge] Scene synced: {len(state)} node(s) sent. "
            f"Server response: {resp.status_code}"
        )
    except requests.ConnectionError:
        cmds.warning(
            "[maya_asset_bridge] sync_to_web: Could not connect to "
            f"{BASE_URL}/scenes/sync — is the backend server running?"
        )
    except requests.HTTPError as exc:
        cmds.warning(f"[maya_asset_bridge] sync_to_web HTTP error: {exc}")
    except Exception as exc:
        cmds.warning(f"[maya_asset_bridge] sync_to_web unexpected error: {exc}")


def clear_imported_assets():
    """
    Remove all FBX-imported root nodes from the scene (keeps default
    cameras, lights, and any geometry not imported via this bridge).

    Nodes imported via :func:`import_asset` or :func:`apply_layout` are
    tracked in the module-level ``_imported_nodes`` list.  Any node that no
    longer exists in Maya is silently skipped.
    """
    global _imported_nodes

    removed: list[str] = []
    failed: list[str] = []

    for node in list(_imported_nodes):
        if not cmds.objExists(node):
            continue  # already deleted or renamed
        try:
            cmds.delete(node)
            removed.append(node)
        except Exception as exc:
            cmds.warning(f"[maya_asset_bridge] Could not delete '{node}': {exc}")
            failed.append(node)

    # Keep only nodes that could not be removed
    _imported_nodes = failed

    if removed:
        print(
            f"[maya_asset_bridge] Cleared {len(removed)} imported node(s): "
            + ", ".join(removed)
        )
    else:
        print("[maya_asset_bridge] No imported assets to clear.")


def select_asset(node_name: str):
    """
    Select a node in Maya by name.

    Parameters
    ----------
    node_name : str
        The name of an existing Maya transform node.

    Raises
    ------
    ValueError
        If the node does not exist in the current scene.
    """
    if not cmds.objExists(node_name):
        raise ValueError(
            f"[maya_asset_bridge] select_asset: node '{node_name}' does not exist."
        )
    cmds.select(node_name, replace=True)
    print(f"[maya_asset_bridge] Selected '{node_name}'")
