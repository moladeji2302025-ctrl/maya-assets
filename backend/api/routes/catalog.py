"""
Catalog management endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks

router = APIRouter()


@router.post("/build")
async def build_catalog(background_tasks: BackgroundTasks):
    """Trigger async catalog build from the asset directory."""
    from services.catalog_builder import build_catalog as _build  # lazy

    def _run():
        return _build(verbose=True)

    background_tasks.add_task(_run)
    return {"status": "started", "message": "Catalog build started in background"}
