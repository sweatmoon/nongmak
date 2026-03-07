import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RULESETS_DIR = DATA_DIR / "rulesets"
OUT_DIR = BASE_DIR / "out"
DB_PATH = BASE_DIR / "orders.db"

OUT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_REGION = "KR-DJ-YS"
DEFAULT_RULESET_VERSION = "v1"

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "https://5173-iwjp415od2cd1og19vt29-a402f90a.sandbox.novita.ai",
]

# 또는 모든 origin 허용 (개발 환경)
CORS_ALLOW_ALL = True
