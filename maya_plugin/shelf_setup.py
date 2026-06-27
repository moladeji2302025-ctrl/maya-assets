"""
Maya Shelf Setup – creates a "AssetLib" shelf with a launcher button.

Run once inside Maya's Script Editor (Python tab):
    import shelf_setup; shelf_setup.install()
"""

import os
import subprocess
import webbrowser

import maya.cmds as cmds
import maya.mel as mel


SHELF_NAME = "AssetLib"
BACKEND_PORT = 8000
APP_URL = f"http://localhost:{BACKEND_PORT}"

_BACKEND_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "backend")
)


def _ensure_shelf():
    """Create the shelf if it doesn't exist; return its layout name."""
    # Maya stores shelves as tabLayout children of the main shelf layout
    top_level = mel.eval("$tmp = $gShelfTopLevel")
    existing = cmds.tabLayout(top_level, q=True, childArray=True) or []

    if SHELF_NAME not in existing:
        mel.eval(f'addNewShelfTab("{SHELF_NAME}")')

    return SHELF_NAME


def _add_button(shelf, label, icon_src, annotation, command):
    """Add a shelf button, replacing any existing one with the same annotation."""
    existing = cmds.shelfLayout(shelf, q=True, childArray=True) or []
    for btn in existing:
        if cmds.objectTypeUI(btn) == "shelfButton":
            if cmds.shelfButton(btn, q=True, annotation=True) == annotation:
                cmds.deleteUI(btn)

    cmds.shelfButton(
        parent=shelf,
        label=label,
        annotation=annotation,
        imageOverlayLabel=label[:3],
        image=icon_src,
        command=command,
        sourceType="python",
        style="iconAndTextVertical",
    )


def install():
    """
    Install the AssetLib shelf.

    Adds two buttons:
      1. Launch   – starts the FastAPI backend and opens the web app in the default browser.
      2. Sync     – sends the current Maya scene state to the web app.
    """
    shelf = _ensure_shelf()

    # ── 1. Launch button ──────────────────────────────────────────────────────
    launch_cmd = f"""
import subprocess, webbrowser, sys, os
backend_dir = r"{_BACKEND_DIR}"
python_exe = sys.executable

# Check if backend is already running
import urllib.request
try:
    urllib.request.urlopen("http://localhost:{BACKEND_PORT}/api/categories", timeout=1)
    print("[AssetLib] Backend already running.")
except Exception:
    # Start backend as detached process
    subprocess.Popen(
        [python_exe, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str({BACKEND_PORT})],
        cwd=backend_dir,
        creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
    )
    print("[AssetLib] Backend started.")

webbrowser.open("{APP_URL}")
print("[AssetLib] Opened {APP_URL}")
"""

    _add_button(
        shelf,
        label="AssetLib",
        icon_src="pythonFamily.png",
        annotation="Open Maya Asset Library",
        command=launch_cmd,
    )

    # ── 2. Sync button ────────────────────────────────────────────────────────
    sync_cmd = """
import sys, os
plugin_dir = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else ""
# Add plugin dir to path so the module can be found
import importlib, maya_asset_bridge as mab
importlib.reload(mab)
mab.sync_to_web()
"""

    _add_button(
        shelf,
        label="Sync",
        icon_src="syncOn.png",
        annotation="Sync Maya scene to Asset Library",
        command=sync_cmd,
    )

    cmds.inViewMessage(
        amg="<hl>AssetLib</hl> shelf installed successfully.",
        pos="midCenter",
        fade=True,
    )
    print(f"[shelf_setup] '{SHELF_NAME}' shelf installed with 2 buttons.")


def uninstall():
    """Remove the AssetLib shelf entirely."""
    top_level = mel.eval("$tmp = $gShelfTopLevel")
    existing = cmds.tabLayout(top_level, q=True, childArray=True) or []
    if SHELF_NAME in existing:
        mel.eval(f'deleteShelfTab("{SHELF_NAME}")')
        print(f"[shelf_setup] '{SHELF_NAME}' shelf removed.")
    else:
        print(f"[shelf_setup] Shelf '{SHELF_NAME}' not found.")


if __name__ == "__main__":
    install()
