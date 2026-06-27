"""
Maya Asset Library – FastAPI entry point.
Run with:  uvicorn main:app --reload --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend/ is on sys.path so all relative imports resolve.
_BACKEND = Path(__file__).resolve().parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database.db import init_db
from api.routes import assets, categories, scenes, ai as ai_routes, catalog
from api.websocket import router as ws_router

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Maya Asset Library",
    version="1.0.0",
    description="AI-powered 3D asset browser and scene composer.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup() -> None:
    settings.ensure_dirs()
    init_db()


# ── API routes ────────────────────────────────────────────────────────────────

app.include_router(assets.router,     prefix="/api/assets",     tags=["assets"])
app.include_router(categories.router, prefix="/api/categories", tags=["categories"])
app.include_router(scenes.router,     prefix="/api/scenes",     tags=["scenes"])
app.include_router(ai_routes.router,  prefix="/api/ai",         tags=["ai"])
app.include_router(catalog.router,    prefix="/api/catalog",    tags=["catalog"])
app.include_router(ws_router,         prefix="/ws",             tags=["websocket"])

# ── Static frontend ───────────────────────────────────────────────────────────

_FRONTEND = _BACKEND.parent / "frontend"
if _FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="frontend")


# ── Dev entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
