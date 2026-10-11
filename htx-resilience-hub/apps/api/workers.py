"""Continuous supervised jobs: 15-minute ingestion and one-minute evaluation."""
import asyncio
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from .db import connection
from .environment import UH, forecast, fresh
from .models import UserPrefs
from .recommendations import next_activity, hour_for, risks, suggestions
from .store import job_update, persist_alert, get_prefs
from .providers import gemini_answer
from .ingest.flood import main as flood_main
from .ingest.air import poll_air
from .flood_anomalies import detect_flood_anomalies

def alert_candidates(prefs: UserPrefs, snapshots: list[dict[str,Any]], now: datetime) -> list[tuple[str,dict[str,Any]]]:
    results: list[tuple[str,dict[str,Any]]] = []
    for routine in prefs.routines:
        at = next_activity(routine,prefs,now)
        if not timedelta(0) <= at-now <= timedelta(hours=1):
            continue
        snapshot = next((f for f in snapshots if f["location"]["id"]==routine.location_id),None)
        if not snapshot or not fresh(snapshot["retrieved_at"],now):
            continue
        hour = hour_for(snapshot["hours"],at)
        if not hour:
            continue
        for category in risks(hour,prefs):
            key = f"{prefs.user_id}:{routine.id}:{hour['time']}:{category}"
            message = f"{routine.activity} at {routine.local_time}: your {category} preference threshold is exceeded in the modeled forecast for {snapshot['location']['name']}."
            results.append((key,{"id":"0","time":now.isoformat(),"user_id":prefs.user_id,"hazard":category,"severity":"watch",
                "message":message,"channel":"dashboard","location_id":routine.location_id,"station_id":None,"suggestions":suggestions(category),"demo":False}))
    return results

async def profiles() -> list[UserPrefs]:
    async with connection() as conn:
        cursor = await conn.execute("SELECT preferences FROM user_prefs WHERE preferences <> '{}'::jsonb")
        return [UserPrefs.model_validate(row["preferences"]) for row in await cursor.fetchall()]

async def ingest_forecasts() -> None:
    prefs = await profiles()
    locations = {(UH.lat,UH.lon):UH}
    for profile in prefs:
        for location in profile.locations:
            locations[(location.lat,location.lon)] = location
    results = await asyncio.gather(*(forecast(loc,force=True) for loc in locations.values()))
    if any(result["storage"]!="database" or any(value=="unavailable" for value in result["source_status"].values()) for result in results):
        raise RuntimeError("Forecast source or storage unavailable")
    await job_update("forecast_ingestion","ok",sum(len(r["hours"]) for r in results))

async def evaluate_alerts() -> None:
    now = datetime.now(timezone.utc)
    async with connection() as conn:
        queued = await (await conn.execute("SELECT id,user_id FROM demo_requests WHERE processed_at IS NULL ORDER BY created_at LIMIT 25")).fetchall()
    for request in queued:
        prefs,_ = await get_prefs(request["user_id"])
        routine = prefs.routines[0] if prefs.routines else None
        location_id = routine.location_id if routine else (prefs.locations[0].id if prefs.locations else "uh")
        activity = f"{routine.activity} at {routine.local_time}" if routine else "your outdoor activity"
        payload = {"id":"0","time":now.isoformat(),"user_id":request["user_id"],"hazard":"heat","severity":"watch",
          "message":f"DEMO: The {os.getenv('HOSTING_PROVIDER','local')} worker processed a simulated forecast above your heat threshold for {activity}. Consider an indoor or cooler-hour activity.",
          "channel":"dashboard","location_id":location_id,"station_id":None,"suggestions":suggestions("heat"),"demo":True}
        await persist_alert("demo:"+request["id"],payload)
        async with connection() as conn:
            await conn.execute("UPDATE demo_requests SET processed_at=now() WHERE id=%s",(request["id"],))
    for prefs in await profiles():
        snapshots = await asyncio.gather(*(forecast(loc) for loc in prefs.locations))
        candidates = alert_candidates(prefs,snapshots,now)
        for key,payload in candidates:
            # Check existing delivery before generation; the insert still enforces concurrent deduplication.
            async with connection() as conn:
                existing = await (await conn.execute("SELECT id FROM alert_events WHERE dedup_key=%s",(key,))).fetchone()
            if not existing:
                from .providers import memory_get
                context = {"preferences":prefs.model_dump(mode="json"),"trigger":payload,
                    "recommendations":[{"title":"Environmental alert","reason":payload["message"],"suggestions":payload["suggestions"]}]}
                answer,provider = await gemini_answer("Explain this threshold-based alert briefly, with a relevant suggested action.",context,await memory_get(prefs))
                if provider == "gemini":
                    payload["message"] = answer
            await persist_alert(key,payload)
    await job_update("alert_evaluator","ok")

async def run_job(name: str, callback: Any) -> None:
    try:
        await callback()
        print(json.dumps({"job":name,"status":"ok","time":datetime.now(timezone.utc).isoformat()}),flush=True)
    except Exception as exc:
        try:
            await job_update(name,"error")
        except Exception:
            pass
        print(json.dumps({"job":name,"status":"error","error_type":type(exc).__name__}),flush=True)

async def ingest_flood() -> None:
    code = await asyncio.to_thread(flood_main)
    if code:
        raise RuntimeError("Flood ingestion failed")
    published = await detect_flood_anomalies()
    if published:
        print(json.dumps({"job":"flood_anomaly_detection","events":published,
                          "time":datetime.now(timezone.utc).isoformat()}),flush=True)

async def ingest_air() -> None:
    if not os.getenv("AIRNOW_API_KEY", "").strip():
        await job_update("air_ingestion", "not configured")
        return
    await job_update("air_ingestion", "ok", await poll_air())

async def periodic(name: str, callback: Any, seconds: int) -> None:
    loop = asyncio.get_running_loop()
    while True:
        started = loop.time()
        await run_job(name, callback)
        await asyncio.sleep(max(0,seconds-(loop.time()-started)))

async def main() -> None:
    from .config import require_env
    require_env("DATABASE_URL")
    await asyncio.gather(
        periodic("flood_ingestion",ingest_flood,900),
        periodic("air_ingestion",ingest_air,3600),
        periodic("forecast_ingestion",ingest_forecasts,900),
        periodic("alert_evaluator",evaluate_alerts,60))

if __name__ == "__main__":
    asyncio.run(main())
