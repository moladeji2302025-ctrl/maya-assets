"""
WebSocket handler for real-time AI chat streaming.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

router = APIRouter()


@router.websocket("/chat")
async def chat_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for streaming AI responses.

    Client sends JSON:  {"prompt": "...", "scene": {...}, "image_b64": null}
    Server streams back text chunks, then a final JSON scene layout.
    """
    from services.ai_composer import stream_compose  # lazy import

    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
                continue

            prompt = data.get("prompt", "")
            scene = data.get("scene", {})
            image_b64 = data.get("image_b64")

            if not prompt:
                await websocket.send_json({"error": "prompt required"})
                continue

            # Stream text tokens
            async for chunk in stream_compose(prompt, scene, image_b64):
                await websocket.send_json(chunk)

    except WebSocketDisconnect:
        pass
