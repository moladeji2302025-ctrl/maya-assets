"""
Maya Command Server – a lightweight HTTP server running inside Maya.

Listens on localhost:8765 for commands from the web app.
Start with:  import maya_server; maya_server.start()
Stop  with:  maya_server.stop()

Endpoints:
    GET  /status               → {"running": true, "scene_nodes": N}
    POST /import               → import an asset FBX
    POST /apply_layout         → batch-place assets from AI layout JSON
    POST /clear                → remove all bridge-imported assets
    GET  /scene                → return current scene state
    POST /select               → select a node by name
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
from urllib.parse import urlparse

import maya.utils as mu  # Maya thread-safe evaluation

HOST = "127.0.0.1"
PORT = 8765

_server: Optional[HTTPServer] = None
_thread: Optional[threading.Thread] = None


# ── Request handler ───────────────────────────────────────────────────────────

class _Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Silence default HTTP log spam in Maya's output
        print(f"[maya_server] {self.address_string()} {fmt % args}")

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg: str, status: int = 400):
        self._send_json({"error": msg}, status)

    def _read_json(self) -> Optional[dict]:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            self._send_error(f"Invalid JSON: {exc}")
            return None

    # ── CORS preflight ──────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── GET ─────────────────────────────────────────────────────────────────────

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/status":
            def _get_status():
                import maya.cmds as cmds
                try:
                    return {"running": True, "scene_nodes": len(cmds.ls(type="transform") or [])}
                except Exception as exc:
                    return {"running": True, "error": str(exc)}

            result = mu.executeInMainThreadWithResult(_get_status)
            self._send_json(result)

        elif path == "/scene":
            def _get_scene():
                import maya_asset_bridge as mab
                return {"nodes": mab.get_scene_state()}

            result = mu.executeInMainThreadWithResult(_get_scene)
            self._send_json(result)

        else:
            self._send_error("Not found", 404)

    # ── POST ────────────────────────────────────────────────────────────────────

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_json()
        if body is None:
            return  # error already sent

        if path == "/import":
            asset_path = body.get("asset_path", "")
            position = tuple(body.get("position", [0, 0, 0]))
            rotation = tuple(body.get("rotation", [0, 0, 0]))
            scale = float(body.get("scale", 1.0))
            name = body.get("name")

            def _do_import():
                import maya_asset_bridge as mab
                try:
                    node = mab.import_asset(asset_path, position, rotation, scale, name)
                    return {"success": True, "node": node}
                except Exception as exc:
                    return {"success": False, "error": str(exc)}

            result = mu.executeInMainThreadWithResult(_do_import)
            self._send_json(result, 200 if result.get("success") else 500)

        elif path == "/apply_layout":
            def _do_layout():
                import maya_asset_bridge as mab
                try:
                    mab.apply_layout(body)
                    return {"success": True}
                except Exception as exc:
                    return {"success": False, "error": str(exc)}

            result = mu.executeInMainThreadWithResult(_do_layout)
            self._send_json(result, 200 if result.get("success") else 500)

        elif path == "/clear":
            def _do_clear():
                import maya_asset_bridge as mab
                try:
                    mab.clear_imported_assets()
                    return {"success": True}
                except Exception as exc:
                    return {"success": False, "error": str(exc)}

            result = mu.executeInMainThreadWithResult(_do_clear)
            self._send_json(result)

        elif path == "/select":
            node_name = body.get("node", "")

            def _do_select():
                import maya_asset_bridge as mab
                try:
                    mab.select_asset(node_name)
                    return {"success": True, "node": node_name}
                except Exception as exc:
                    return {"success": False, "error": str(exc)}

            result = mu.executeInMainThreadWithResult(_do_select)
            self._send_json(result)

        else:
            self._send_error("Not found", 404)


# ── Server lifecycle ──────────────────────────────────────────────────────────

def start(host: str = HOST, port: int = PORT):
    """Start the Maya command server in a background thread."""
    global _server, _thread

    if _server is not None:
        print(f"[maya_server] Already running on {host}:{port}")
        return

    _server = HTTPServer((host, port), _Handler)
    _thread = threading.Thread(target=_server.serve_forever, daemon=True)
    _thread.start()
    print(f"[maya_server] Listening on http://{host}:{port}")


def stop():
    """Stop the Maya command server."""
    global _server, _thread

    if _server is None:
        print("[maya_server] Not running.")
        return

    _server.shutdown()
    _server = None
    _thread = None
    print("[maya_server] Stopped.")


def restart(host: str = HOST, port: int = PORT):
    stop()
    start(host, port)


def is_running() -> bool:
    return _server is not None
