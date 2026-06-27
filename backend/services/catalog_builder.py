"""
Asset catalog builder for Maya Asset Library.

Scans E:/Assets/Assets-Models recursively for .fbx files, derives metadata,
auto-categorizes each asset, and upserts records into the SQLite assets table.

CLI usage:
    python catalog_builder.py

Importable:
    from services.catalog_builder import build_catalog
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Optional

# ── optional trimesh import ───────────────────────────────────────────────────
try:
    import trimesh  # type: ignore

    _TRIMESH_AVAILABLE = True
except ImportError:
    _TRIMESH_AVAILABLE = False

# ─── Add backend dir to sys.path when run as script ──────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from config import settings  # noqa: E402 – after sys.path fix

# ─── Category keyword mapping ─────────────────────────────────────────────────
# Keys are canonical category names matching the seeded categories table.
# Values are lowercase keyword substrings; matching is against the lower-cased
# filename (without extension).

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Architecture": [
        "house", "building", "castle", "temple", "shop", "facade", "villa",
        "apartment", "cabin", "cottage", "mansion", "palace", "tower", "church",
        "cathedral", "mosque", "skyscraper", "warehouse", "barn", "bungalow",
        "hut", "igloo", "lighthouse", "museum", "school", "hospital_building",
    ],
    "Structural": [
        "wall", "floor", "stair", "arch", "column", "pillar", "beam",
        "platform", "ceiling", "railing", "foundation", "slab", "truss",
        "girder", "concrete", "brick", "mortar", "post", "joist",
    ],
    "Doors & Windows": [
        "door", "window", "shutter", "blind", "gate", "doorframe",
        "windowframe", "hinge", "doorknob", "skylight", "porthole",
    ],
    "Furniture": [
        "chair", "table", "sofa", "bed", "shelf", "cabinet", "desk",
        "couch", "bench", "stool", "armchair", "bookcase", "wardrobe",
        "dresser", "ottoman", "futon", "loveseat", "chaise", "bunk",
        "crib", "nightstand", "sideboard", "credenza", "console",
    ],
    "Lighting": [
        "light", "lamp", "lantern", "chandelier", "pendant", "sconce",
        "torch", "bulb", "spotlight", "floodlight", "streetlight",
        "neon", "led", "candle", "candelabra", "flashlight", "headlight",
    ],
    "Kitchen & Dining": [
        "kitchen", "pot", "pan", "cup", "plate", "bowl", "fork",
        "spoon", "knife", "mug", "kettle", "appliance", "microwave",
        "oven", "refrigerator", "fridge", "toaster", "blender",
        "cutting board", "colander", "spatula", "ladle", "tongs",
        "chopstick", "saucepan", "wok", "grater", "peeler",
    ],
    "Exterior & Landscape": [
        "fence", "garden", "tree", "plant", "gazebo", "shed", "awning",
        "carport", "path", "bridge", "patio", "deck", "pergola",
        "trellis", "fountain", "pond", "rock", "stone", "grass",
        "flower", "bush", "shrub", "hedge", "sidewalk", "driveway",
        "mailbox", "lamppost", "bench_outdoor",
    ],
    "Vehicles & Transport": [
        "car", "truck", "motorcycle", "bike", "boat", "ship", "plane",
        "vehicle", "trailer", "bus", "van", "suv", "pickup", "sedan",
        "coupe", "convertible", "jeep", "tank", "helicopter", "jet",
        "aircraft", "submarine", "yacht", "ferry", "tractor",
        "forklift", "crane_vehicle", "ambulance", "firetruck",
        "police_car", "taxi",
    ],
    "Vehicle Parts": [
        "rim", "tire", "wheel", "seat", "exhaust", "brake", "bumper",
        "hood", "door_car", "mirror", "engine", "transmission",
        "headlamp", "taillight", "grille", "fender", "spoiler",
        "dashboard", "steering", "axle", "suspension", "muffler",
    ],
    "Apparel - Clothing": [
        "shirt", "pants", "dress", "jacket", "coat", "hoodie", "suit",
        "skirt", "uniform", "sportswear", "t-shirt", "tshirt", "blouse",
        "sweater", "vest", "shorts", "jeans", "leggings", "cardigan",
        "trench", "overalls", "tunic", "robe", "toga", "poncho",
        "raincoat", "parka", "tracksuit", "swimsuit", "bikini",
    ],
    "Apparel - Footwear": [
        "shoe", "boot", "sneaker", "heel", "sandal", "slipper",
        "loafer", "moccasin", "clog", "wedge", "stiletto", "oxford",
        "derby", "espadrille", "flip flop", "flipflop", "croc",
        "platform_shoe",
    ],
    "Apparel - Bags": [
        "bag", "backpack", "handbag", "wallet", "purse", "duffel",
        "pouch", "case", "clutch", "tote", "satchel", "messenger",
        "briefcase", "luggage", "suitcase", "fanny", "crossbody",
        "diaper_bag",
    ],
    "Apparel - Headwear": [
        "helmet", "hat", "cap", "mask", "visor", "beanie", "beret",
        "fedora", "bowler", "tophat", "top_hat", "baseball_cap",
        "hard_hat", "crown", "tiara", "headband", "turban", "hijab",
        "face_mask",
    ],
    "Apparel - Accessories": [
        "watch", "ring", "necklace", "bracelet", "belt", "glove",
        "sunglasses", "jewelry", "chain", "earring", "brooch",
        "cufflink", "tie", "bowtie", "bow_tie", "scarf", "mitten",
        "hair_clip", "hairpin", "pendant_jewelry",
    ],
    "Apparel - Fasteners": [
        "button", "zipper", "buckle", "clasp", "snap", "hook",
        "cord stopper", "velcro", "rivet", "eyelet", "toggle",
        "drawstring",
    ],
    "Food": [
        "fruit", "vegetable", "apple", "bread", "meat", "fish",
        "sushi", "pizza", "burger", "cake", "egg", "milk",
        "orange", "banana", "strawberry", "tomato", "carrot",
        "broccoli", "corn", "lettuce", "onion", "potato",
        "steak", "chicken", "pork", "shrimp", "lobster",
        "sandwich", "hotdog", "hot_dog", "taco", "burrito",
        "pasta", "noodle", "rice", "salad", "soup",
    ],
    "Drinks & Bottles": [
        "bottle", "can", "beer", "wine", "juice", "water",
        "dispenser", "flask", "glass_drink", "cocktail", "soda",
        "cup_drink", "thermos", "carton", "pitcher", "decanter",
        "mug_drink",
    ],
    "Candy & Snacks": [
        "candy", "chocolate", "gum", "ice cream", "icecream",
        "biscuit", "lollipop", "snack", "cookie", "chip",
        "pretzel", "popcorn", "gummy", "marshmallow", "toffee",
        "caramel", "truffle", "bonbon", "wafer",
    ],
    "Camping & Outdoor": [
        "tent", "sleeping bag", "campfire", "stove", "cooler",
        "camping", "outdoor", "lantern_camp", "hammock",
        "backpack_outdoor", "compass", "map", "canteen",
        "tarp", "rope", "axe", "hatchet",
    ],
    "Military & Tactical": [
        "weapon", "gun", "rifle", "armor", "military", "tactical",
        "bunker", "barracks", "holster", "pistol", "shotgun",
        "sniper", "grenade", "knife_weapon", "sword", "shield",
        "crossbow", "bow_weapon", "arrow", "spear", "axe_weapon",
        "mace", "bayonet", "magazine", "ammo", "bullet",
        "bomb", "missile", "rocket", "mine", "explosive",
    ],
    "Hardware & Mechanical": [
        "pipe", "vent", "handle", "screw", "bolt", "gear",
        "propeller", "drone", "crank", "valve", "wrench",
        "hammer", "drill", "saw", "nail", "nut", "washer",
        "spring", "pulley", "chain_mech", "belt_mech",
        "motor", "pump", "compressor", "radiator",
        "fan", "turbine", "piston", "cylinder",
    ],
    "Sci-Fi & Covers": [
        "sci-fi", "scifi", "hatch", "futuristic", "portal",
        "cover", "panel", "spaceship", "robot", "android",
        "hologram", "laser", "plasma", "force_field",
        "alien", "ufo", "cyberpunk", "mech", "exosuit",
        "terminal", "console_scifi",
    ],
    "Ancient & Historical": [
        "ancient", "egyptian", "medieval", "historical",
        "artifact", "relic", "canopic", "sarcophagus",
        "pyramid", "sphinx", "roman", "greek", "viking",
        "samurai", "knight", "gladiator", "rune", "totem",
        "idol", "scroll", "vase_ancient",
    ],
    "Decor & Ornaments": [
        "ornament", "floral", "moulding", "corbel", "curtain",
        "vase", "decoration", "frame", "trophy", "statue",
        "figurine", "bust", "relief", "frieze", "fresco",
        "tapestry", "rug", "carpet", "clock", "mirror_decor",
        "painting", "poster", "sculpture",
    ],
    "Interiors": [
        "interior", "molding", "baseboard", "background",
        "wallpaper", "ceiling_tile", "floor_tile",
        "partition", "room", "hallway", "corridor",
        "lobby", "foyer", "atrium",
    ],
    "Medical": [
        "hospital", "bed_medical", "stretcher", "surgical",
        "medical", "splint", "syringe", "wheelchair",
        "crutch", "stethoscope", "pill", "capsule",
        "bandage", "iv_stand", "heart_monitor",
        "operating_table", "scalpel", "forceps",
    ],
    # Miscellaneous is the fallback — matched last
    "Miscellaneous": [],
}

# Pre-build ordered list: Miscellaneous always last
_ORDERED_CATEGORIES: list[str] = [
    k for k in CATEGORY_KEYWORDS if k != "Miscellaneous"
] + ["Miscellaneous"]

# Duplicate-detection pattern: filenames like "name (1).fbx", "name (2).fbx"
_DUPLICATE_RE = re.compile(r"\s+\(\d+\)$")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _is_duplicate(stem: str) -> bool:
    """Return True if the filename stem ends with ' (N)'."""
    return bool(_DUPLICATE_RE.search(stem))


def _to_display_name(stem: str) -> str:
    """Convert a filename stem to a human-readable display name."""
    name = stem.replace("_", " ").replace("-", " ")
    # collapse multiple spaces
    name = re.sub(r"\s{2,}", " ", name).strip()
    return name.title()


def _categorize(stem: str) -> str:
    """Return the best-matching category name for a given filename stem."""
    lower = stem.lower()
    for category in _ORDERED_CATEGORIES:
        keywords = CATEGORY_KEYWORDS[category]
        if any(kw in lower for kw in keywords):
            return category
    return "Miscellaneous"


def _mesh_metadata(fbx_path: str) -> dict:
    """
    Attempt to load FBX with trimesh and extract bounding-box + poly count.
    Returns a dict with keys bbox_width, bbox_height, bbox_depth, poly_count.
    All values default to None on failure.
    """
    result: dict = {
        "bbox_width": None,
        "bbox_height": None,
        "bbox_depth": None,
        "poly_count": None,
    }

    if not _TRIMESH_AVAILABLE:
        return result

    try:
        scene = trimesh.load(fbx_path, force="scene")

        # Collect all meshes
        meshes = []
        if isinstance(scene, trimesh.Scene):
            meshes = [
                g for g in scene.geometry.values()
                if isinstance(g, trimesh.Trimesh)
            ]
        elif isinstance(scene, trimesh.Trimesh):
            meshes = [scene]

        if not meshes:
            return result

        # Aggregate bounding box
        all_bounds = [m.bounds for m in meshes]  # list of [[min], [max]]
        import numpy as np  # trimesh already depends on numpy

        combined_min = np.min([b[0] for b in all_bounds], axis=0)
        combined_max = np.max([b[1] for b in all_bounds], axis=0)
        extents = combined_max - combined_min

        result["bbox_width"] = float(extents[0])
        result["bbox_height"] = float(extents[1])
        result["bbox_depth"] = float(extents[2])
        result["poly_count"] = sum(len(m.faces) for m in meshes)

    except Exception:
        pass  # graceful degradation

    return result


# ─── Core build function ──────────────────────────────────────────────────────

def build_catalog(
    db_path: Optional[str] = None,
    asset_path: Optional[str] = None,
    verbose: bool = True,
) -> dict[str, int]:
    """
    Scan `asset_path` for .fbx files and upsert records into the `assets` table.

    Parameters
    ----------
    db_path : str, optional
        Absolute path to the SQLite file. Defaults to settings.db_path_abs.
    asset_path : str, optional
        Root directory to scan. Defaults to settings.ASSET_PATH.
    verbose : bool
        Print progress to stdout.

    Returns
    -------
    dict with keys "scanned", "inserted", "skipped_duplicate", "skipped_existing".
    """
    from database.db import get_db, init_db  # local import to avoid circular deps

    resolved_db = str(db_path) if db_path else str(settings.db_path_abs)
    resolved_asset = str(asset_path) if asset_path else settings.ASSET_PATH

    # Ensure schema exists
    init_db()

    # Override DB_PATH temporarily by patching the module — simpler: just open directly
    conn = sqlite3.connect(resolved_db, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")

    counters = {
        "scanned": 0,
        "inserted": 0,
        "skipped_duplicate": 0,
        "skipped_existing": 0,
    }

    asset_root = Path(resolved_asset)
    if not asset_root.exists():
        if verbose:
            print(f"[WARNING] Asset path does not exist: {asset_root}", flush=True)
        conn.close()
        return counters

    # Collect all FBX files
    fbx_files = list(asset_root.rglob("*.fbx")) + list(asset_root.rglob("*.FBX"))
    total = len(fbx_files)

    if verbose:
        print(f"Found {total} FBX files under {asset_root}", flush=True)

    for idx, fbx_path in enumerate(fbx_files, start=1):
        stem = fbx_path.stem
        filepath_str = str(fbx_path).replace("\\", "/")

        # Skip duplicates like "Model (1).fbx"
        if _is_duplicate(stem):
            counters["skipped_duplicate"] += 1
            continue

        counters["scanned"] += 1

        # Check for existing record
        existing = conn.execute(
            "SELECT id FROM assets WHERE filepath = ?", (filepath_str,)
        ).fetchone()

        if existing:
            counters["skipped_existing"] += 1
            if verbose and idx % 100 == 0:
                print(
                    f"  [{idx}/{total}] Progress — inserted: {counters['inserted']}, "
                    f"skipped existing: {counters['skipped_existing']}",
                    flush=True,
                )
            continue

        # Derive metadata
        display_name = _to_display_name(stem)
        category = _categorize(stem)
        file_size: Optional[int] = None
        try:
            file_size = fbx_path.stat().st_size
        except OSError:
            pass

        mesh_meta = _mesh_metadata(str(fbx_path))

        conn.execute(
            """
            INSERT OR IGNORE INTO assets
                (filename, filepath, display_name, category, subcategory,
                 tags, file_size, bbox_width, bbox_height, bbox_depth, poly_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fbx_path.name,
                filepath_str,
                display_name,
                category,
                None,  # subcategory — can be enriched later
                "[]",  # tags
                file_size,
                mesh_meta["bbox_width"],
                mesh_meta["bbox_height"],
                mesh_meta["bbox_depth"],
                mesh_meta["poly_count"],
            ),
        )

        if conn.execute("SELECT changes()").fetchone()[0] > 0:
            counters["inserted"] += 1

        # Commit in batches of 200 to keep transactions small
        if counters["inserted"] % 200 == 0 and counters["inserted"] > 0:
            conn.commit()

        if verbose and idx % 100 == 0:
            print(
                f"  [{idx}/{total}] inserted: {counters['inserted']}, "
                f"duplicates skipped: {counters['skipped_duplicate']}, "
                f"already in DB: {counters['skipped_existing']}",
                flush=True,
            )

    conn.commit()
    conn.close()

    if verbose:
        print(
            f"\nCatalog build complete.\n"
            f"  Scanned : {counters['scanned']}\n"
            f"  Inserted: {counters['inserted']}\n"
            f"  Skipped (duplicates): {counters['skipped_duplicate']}\n"
            f"  Skipped (already in DB): {counters['skipped_existing']}",
            flush=True,
        )

    return counters


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    build_catalog()
