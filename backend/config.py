"""
Application configuration for Maya Asset Library.
Import as: from config import settings
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Load .env file if present (must happen before Settings is instantiated)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

# The project root is one level above the backend/ directory.
_BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT: Path = _BACKEND_DIR.parent


@dataclass
class Settings:
    # --- Asset source ---
    ASSET_PATH: str = "E:/Assets/Assets-Models"

    # --- Database / generated data (relative to PROJECT_ROOT) ---
    DB_PATH: str = "data/assets.db"
    THUMBNAIL_DIR: str = "data/thumbnails"
    GLTF_DIR: str = "data/gltf"

    # --- Anthropic ---
    ANTHROPIC_API_KEY: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))

    # --- Server ---
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # --- Thumbnail ---
    MAX_THUMBNAIL_SIZE: tuple[int, int] = (256, 256)

    # --- Resolved absolute paths (computed on first access via property) ---
    @property
    def db_path_abs(self) -> Path:
        return (PROJECT_ROOT / self.DB_PATH).resolve()

    @property
    def thumbnail_dir_abs(self) -> Path:
        return (PROJECT_ROOT / self.THUMBNAIL_DIR).resolve()

    @property
    def gltf_dir_abs(self) -> Path:
        return (PROJECT_ROOT / self.GLTF_DIR).resolve()

    @property
    def asset_path_abs(self) -> Path:
        return Path(self.ASSET_PATH).resolve()

    def ensure_dirs(self) -> None:
        """Create all data directories if they don't exist."""
        self.db_path_abs.parent.mkdir(parents=True, exist_ok=True)
        self.thumbnail_dir_abs.mkdir(parents=True, exist_ok=True)
        self.gltf_dir_abs.mkdir(parents=True, exist_ok=True)


# Singleton instance consumed everywhere else.
settings = Settings()
