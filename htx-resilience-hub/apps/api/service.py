"""Shared environmental evidence for UI, Q&A, and alert workers."""
import asyncio
from datetime import datetime, timezone
from typing import Any
from .environment import UH, forecast, hazards
from .recommendations import build_recommendations
from .store import get_prefs

async def briefing(user_id: str) -> dict[str,Any]:
    prefs,storage = await get_prefs(user_id)
    locations = prefs.locations or [UH]
    forecasts = await asyncio.gather(*(forecast(loc) for loc in locations))
    flood,mode = await hazards()
    now = datetime.now(timezone.utc)
    return {"generated_at":now.isoformat(),"timezone":prefs.timezone,"locations":[loc.model_dump() for loc in locations],
      "forecasts":forecasts,"hazards":flood,"recommendations":build_recommendations(prefs,forecasts,flood,now),
      "source_status":{"flood":mode,"grid":"demo; live integration deferred", "weather":"live model" if any(f["source_status"].get("weather")=="live model" for f in forecasts) else "unavailable",
                       "air":"live model" if any(f["source_status"].get("air")=="live model" for f in forecasts) else "unavailable", "preferences":storage},
      "coverage":"Gage heights are station-specific observations without flood-stage ratings here. No road-closure feed or route safety assessment."}
