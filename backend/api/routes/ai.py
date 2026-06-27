"""
AI scene composition endpoints (REST + SSE streaming).
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class ComposeRequest(BaseModel):
    prompt: str
    scene: Optional[dict] = None
    image_b64: Optional[str] = None


class AdjustRequest(BaseModel):
    instruction: str
    scene: dict


class SuggestRequest(BaseModel):
    context: str
    scene: Optional[dict] = None


@router.post("/compose")
async def compose_scene(body: ComposeRequest):
    """Generate a scene layout from a natural-language prompt."""
    from services.ai_composer import compose  # lazy
    try:
        result = await compose(body.prompt, body.scene or {}, body.image_b64)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/compose/stream")
async def compose_scene_stream(body: ComposeRequest):
    """Stream scene composition as SSE."""
    from services.ai_composer import stream_compose  # lazy

    async def event_generator():
        async for chunk in stream_compose(body.prompt, body.scene or {}, body.image_b64):
            yield f"data: {json.dumps(chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/adjust")
async def adjust_scene(body: AdjustRequest):
    """Adjust an existing scene layout based on a natural-language instruction."""
    from services.ai_composer import adjust  # lazy
    try:
        result = await adjust(body.instruction, body.scene)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/suggest")
async def suggest_assets(body: SuggestRequest):
    """Get asset suggestions for the current scene context."""
    from services.ai_composer import suggest  # lazy
    try:
        result = await suggest(body.context, body.scene or {})
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
