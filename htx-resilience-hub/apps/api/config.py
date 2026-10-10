"""Environment settings shared by API entry points."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve consistently for both `uvicorn main:app` and `uvicorn apps.api.main:app`.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}. Copy .env.example to .env and configure it.")
    return value
