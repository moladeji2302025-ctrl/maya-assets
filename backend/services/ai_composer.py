"""
AI scene composer – OpenRouter (OpenAI-compatible API).

Provides:
    compose(prompt, scene, image_b64)         → scene layout dict (awaitable)
    adjust(instruction, scene)                → updated scene dict (awaitable)
    suggest(context, scene)                   → suggestion list (awaitable)
    stream_compose(prompt, scene, image_b64)  → async generator of chunk dicts
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import AsyncGenerator, Optional

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from config import settings

try:
    from openai import AsyncOpenAI  # type: ignore
    _OPENAI_OK = True
except ImportError:
    _OPENAI_OK = False

_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
_TEXT_MODEL      = "openrouter/owl-alpha"
_VISION_MODEL    = "google/gemma-4-26b-a4b-it:free"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_client() -> "AsyncOpenAI":
    if not _OPENAI_OK:
        raise RuntimeError("openai SDK not installed. Run: pip install openai")
    key = settings.OPENROUTER_API_KEY
    if not key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. "
            "Get a free key at openrouter.ai and add it to backend/.env"
        )
    return AsyncOpenAI(
        base_url=_OPENROUTER_BASE,
        api_key=key,
        default_headers={
            "HTTP-Referer": "http://localhost:8000",
            "X-Title": "Maya Asset Library",
        },
    )


def _get_asset_catalog(limit: int = 3000) -> list[dict]:
    from database.db import get_db
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT id, display_name, category, subcategory,
                   bbox_width, bbox_height, bbox_depth
            FROM assets
            ORDER BY category, display_name
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(zip(row.keys(), tuple(row))) for row in rows]
    finally:
        conn.close()


def _build_system_prompt(catalog: list[dict]) -> str:
    catalog_text = "\n".join(
        f"  ID:{a['id']} | {a['display_name']} | {a['category']}"
        + (f" | {a['subcategory']}" if a.get("subcategory") else "")
        + (
            f" | {a['bbox_width']:.1f}x{a['bbox_height']:.1f}x{a['bbox_depth']:.1f}"
            if all(a.get(k) is not None for k in ("bbox_width", "bbox_height", "bbox_depth"))
            else ""
        )
        for a in catalog
    )
    return f"""You are an expert 3D scene designer with direct control over a live 3D scene.
You have access to a library of {len(catalog)} 3D assets listed below.

## Asset Catalog
{catalog_text}

## Your job
You make changes to the scene IMMEDIATELY and AUTOMATICALLY — no confirmation needed.
Respond with:
1. A SHORT conversational message (1–2 sentences) describing what you did or are doing.
2. A <scene_actions> block listing every change to make.

## <scene_actions> format
<scene_actions>
[
  {{"action": "add",    "asset_id": <int>, "display_name": "<name>", "position": [x,y,z], "rotation": [rx,ry,rz], "scale": <float>}},
  {{"action": "move",   "item_id": <int>,  "position": [x,y,z], "rotation": [rx,ry,rz]}},
  {{"action": "scale",  "item_id": <int>,  "scale": <float>}},
  {{"action": "remove", "item_id": <int>}}
]
</scene_actions>

- `add`    → place a new asset from the catalog. Use asset_id from the catalog.
- `move`   → reposition/reorient an existing item. Use item_id from the current scene state.
- `scale`  → resize an existing item. Use item_id from the current scene state.
- `remove` → delete an existing item. Use item_id from the current scene state.

## Placement & stacking rules
- Y=0 is the ground plane. Objects resting on the floor have position.y = 0.
- **Catalog bbox dimensions are in Maya centimetres. World height = bbox_height × 0.01** (at scale 1.0).
- Each item in the current scene state includes `surface_y` — the **actual top surface height** of that object in world space. Always use this when placing something on top of an existing scene object.
  - Example: table has surface_y = 0.74 → lamp.position.y = 0.74
- When placing object B on top of object A that you are **also adding** in the same response (not yet in the scene), estimate:
  - `A_surface_y = A.position.y + A.bbox_height × 0.01 × A.scale`
  - Then set `B.position.y = A_surface_y`
- Objects placed **inside** a container (bowl, box, shelf) should have position.y slightly above the container's surface_y (add ~0.05–0.1 for a small object resting inside).
- **Never** place all objects at y=0 when they are supposed to be stacked, mounted, or resting on each other.
- Spread the scene naturally — don't pile everything at the origin.
- Use realistic scales relative to each other.
- Only use asset IDs that appear in the catalog above.
- Only use item_ids that appear in the current scene state sent by the user.
- Maximum 20 new assets per response unless the user requests more.
- If the user asks a question without requesting changes, answer conversationally with no <scene_actions> block.
"""


def _build_messages(
    prompt: str,
    scene: dict,
    image_b64: Optional[str],
    system: str,
) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": system}]

    scene_str = json.dumps(scene, indent=2) if scene else "{}"
    text_content = (
        f"Current scene state:\n{scene_str}\n\n"
        f"User request: {prompt}"
    )

    if image_b64:
        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                },
                {"type": "text", "text": text_content},
            ],
        })
    else:
        messages.append({"role": "user", "content": text_content})

    return messages


def _parse_scene_actions(text: str) -> Optional[list]:
    match = re.search(r"<scene_actions>(.*?)</scene_actions>", text, re.DOTALL)
    if not match:
        return None
    try:
        result = json.loads(match.group(1).strip())
        return result if isinstance(result, list) else None
    except json.JSONDecodeError:
        return None


def _strip_actions(text: str) -> str:
    return re.sub(r"<scene_actions>.*?</scene_actions>", "", text, flags=re.DOTALL).strip()


# ── Public API ────────────────────────────────────────────────────────────────

async def compose(
    prompt: str,
    scene: dict,
    image_b64: Optional[str] = None,
) -> dict:
    client  = _get_client()
    catalog = _get_asset_catalog()
    system  = _build_system_prompt(catalog)
    model   = _VISION_MODEL if image_b64 else _TEXT_MODEL
    messages = _build_messages(prompt, scene, image_b64, system)

    response = await client.chat.completions.create(
        model=model,
        max_tokens=4096,
        messages=messages,
    )

    raw     = response.choices[0].message.content
    actions = _parse_scene_actions(raw)
    message = _strip_actions(raw)
    return {"message": message, "actions": actions, "raw": raw}


async def adjust(instruction: str, scene: dict) -> dict:
    client  = _get_client()
    catalog = _get_asset_catalog()
    system  = _build_system_prompt(catalog)

    scene_str = json.dumps(scene, indent=2)
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": (
                f"Current scene:\n{scene_str}\n\n"
                f"Adjustment requested: {instruction}\n\n"
                "Apply the adjustment and return a <scene_actions> block."
            ),
        },
    ]

    response = await client.chat.completions.create(
        model=_TEXT_MODEL,
        max_tokens=4096,
        messages=messages,
    )

    raw     = response.choices[0].message.content
    actions = _parse_scene_actions(raw)
    message = _strip_actions(raw)
    return {"message": message, "actions": actions, "raw": raw}


async def suggest(context: str, scene: dict) -> dict:
    client  = _get_client()
    catalog = _get_asset_catalog()
    system  = _build_system_prompt(catalog)

    scene_str = json.dumps(scene, indent=2)
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": (
                f"Current scene:\n{scene_str}\n\n"
                f"Context: {context}\n\n"
                "Suggest 5–10 assets from the catalog that would complement this scene. "
                "Return them as a <scene_actions> block with suggested add actions."
            ),
        },
    ]

    response = await client.chat.completions.create(
        model=_TEXT_MODEL,
        max_tokens=2048,
        messages=messages,
    )

    raw     = response.choices[0].message.content
    actions = _parse_scene_actions(raw)
    message = _strip_actions(raw)
    suggestions = [a for a in (actions or []) if a.get("action") == "add"]
    return {"message": message, "suggestions": suggestions, "raw": raw}


async def stream_compose(
    prompt: str,
    scene: dict,
    image_b64: Optional[str] = None,
) -> AsyncGenerator[dict, None]:
    """
    Stream a scene composition as an async generator of chunk dicts.

    Yields:
        {"type": "text",    "content": str}   — incremental text
        {"type": "actions", "content": list}  — final parsed action list
        {"type": "done"}                      — stream complete
        {"type": "error",   "content": str}   — on failure
    """
    try:
        client = _get_client()
    except RuntimeError as exc:
        yield {"type": "error", "content": str(exc)}
        return

    catalog  = _get_asset_catalog()
    system   = _build_system_prompt(catalog)
    model    = _VISION_MODEL if image_b64 else _TEXT_MODEL
    messages = _build_messages(prompt, scene, image_b64, system)

    full_text = ""
    try:
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=4096,
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                full_text += delta
                yield {"type": "text", "content": delta}

        actions = _parse_scene_actions(full_text)
        if actions:
            yield {"type": "actions", "content": actions}

        yield {"type": "done"}

    except Exception as exc:
        yield {"type": "error", "content": str(exc)}
