"""noach.select: environmental context, grounded AI, preferences and persistent SSE."""
import asyncio
import hmac
import json
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request, Query, Response
from fastapi.responses import StreamingResponse, JSONResponse

# Support both documented uvicorn entry points.
if not __package__:
    import sys
    from pathlib import Path
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from apps.api.config import require_env
from apps.api.db import connection
from apps.api.models import AskRequest, AskResponse, UserPrefs, HazardReading
from apps.api.environment import hazards
from apps.api.providers import gemini_answer, memory_get, memory_sync
from apps.api.service import briefing
from apps.api.store import get_prefs, save_prefs, alerts_after, persist_alert, demo_mode, DEMO_ALERTS
from apps.api.recommendations import suggestions

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    require_env("DATABASE_URL")
    if os.getenv("NOACH_ENV") == "production":
        require_env("INTERNAL_API_TOKEN")
    yield

app = FastAPI(title="noach.select",version="0.2.0",lifespan=lifespan)

@app.middleware("http")
async def internal_access(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    token = os.getenv("INTERNAL_API_TOKEN","")
    if token and request.url.path != "/health" and not hmac.compare_digest(request.headers.get("x-internal-token",""),token):
        return JSONResponse({"detail":"Internal API access required"},status_code=401)
    return await call_next(request)

@app.get("/health")
async def health() -> dict[str,str]:
    return {"status":"ok","service":"noach.select","mode":"demo-enabled" if demo_mode() else "live"}

@app.get("/api/hazards",response_model=list[HazardReading])
async def hazard_route(response: Response) -> list[dict]:
    rows,mode = await hazards()
    response.headers["X-Data-Mode"] = mode
    return rows

@app.get("/api/hazards/history")
async def history(station_id: str = Query(max_length=40), metric: str = Query(max_length=150)) -> list[dict]:
    try:
        async with connection() as conn:
            cursor = await conn.execute("SELECT bucket AS time,avg_value AS value FROM hourly_station_avg WHERE station_id=%s AND metric=%s AND bucket>now()-interval '24 hours' ORDER BY bucket",(station_id,metric))
            return [{"time":row["time"].isoformat(),"value":row["value"]} for row in await cursor.fetchall()]
    except Exception:
        return []

@app.get("/api/prefs")
async def preferences(user_id: str = Query(min_length=1,max_length=100)) -> dict:
    try:
        prefs,storage = await get_prefs(user_id)
        return {"preferences":prefs.model_dump(mode="json"),"storage":storage}
    except Exception:
        raise HTTPException(503,"Preferences unavailable; check database configuration and migrations")

@app.post("/api/prefs")
async def preferences_save(prefs: UserPrefs) -> dict:
    try:
        storage = await save_prefs(prefs)
    except Exception:
        raise HTTPException(503,"Preferences could not be saved; no durable change was confirmed")
    memory = await memory_sync(prefs)
    return {"preferences":prefs.model_dump(mode="json"),"storage":storage,"memory":memory}

@app.get("/api/briefing")
async def briefing_route(user_id: str = Query(min_length=1,max_length=100)) -> dict:
    try:
        if os.getenv("VERCEL"):
            from apps.api.serverless import maintain
            await maintain()
        return await briefing(user_id)
    except Exception:
        raise HTTPException(503,"Briefing unavailable; check database settings or explicitly enable NOACH_DEMO_MODE")

@app.post("/api/ask",response_model=AskResponse)
async def ask(payload: AskRequest, response: Response) -> AskResponse:
    try:
        context = await briefing(payload.user_id or "guest")
        prefs,_ = await get_prefs(payload.user_id or "guest")
        context["saved_preferences"] = prefs.model_dump(mode="json",exclude={"user_id"})
        answer,provider = await gemini_answer(payload.question,context,await memory_get(prefs))
        response.headers["X-AI-Provider"] = provider
        return AskResponse(answer=answer)
    except Exception:
        raise HTTPException(503,"Environmental context unavailable; please retry")

@app.get("/api/alerts")
async def alert_stream(request: Request,user_id: str = Query(min_length=1,max_length=100),after: int = Query(default=0,ge=0)) -> StreamingResponse:
    try:
        cursor_id = max(after,int(request.headers.get("last-event-id","0")))
    except ValueError:
        cursor_id = after
    async def events() -> AsyncIterator[str]:
        nonlocal cursor_id
        started = time.monotonic()
        yield 'event: ready\ndata: {"status":"connected"}\n\n'
        while not await request.is_disconnected():
            if os.getenv("VERCEL") and time.monotonic() - started >= 240:
                break  # EventSource reconnects with Last-Event-ID.
            try:
                for alert in await alerts_after(user_id,cursor_id):
                    cursor_id = int(alert["id"])
                    yield f"id: {cursor_id}\nevent: alert\ndata: {json.dumps(alert)}\n\n"
            except Exception:
                yield 'event: status\ndata: {"status":"alert storage unavailable"}\n\n'
            yield ": heartbeat\n\n"
            await asyncio.sleep(5)
    return StreamingResponse(events(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

@app.post("/api/alerts/demo")
async def demo_alert(payload: AskRequest) -> dict:
    user_id = payload.user_id or "guest"
    alert = {"id":"0","time":datetime.now(timezone.utc).isoformat(),"user_id":user_id,"hazard":"heat","severity":"watch",
      "message":"DEMO: A simulated feels-like forecast crossed your exercise threshold. Consider an indoor or cooler-hour activity.",
      "channel":"dashboard","location_id":"uh","station_id":None,"suggestions":suggestions("heat"),"demo":True}
    try:
        request_id = str(uuid4())
        async with connection() as conn:
            await conn.execute("INSERT INTO demo_requests(id,user_id) VALUES (%s,%s)",(request_id,user_id))
        if os.getenv("VERCEL"):
            from apps.api.serverless import maintain
            await maintain(force_alerts=True)
        return {"status":"queued","demo":True,"request_id":request_id}
    except Exception:
        if not demo_mode():
            raise HTTPException(503,"Demo alert could not be persisted")
        alert["message"] = "DEMO LOCAL FALLBACK (worker unavailable): " + alert["message"]
        alert["id"] = str(len(DEMO_ALERTS)+1)
        DEMO_ALERTS.append(alert)
        return alert

@app.get("/api/status")
async def status() -> dict:
    jobs: list[dict] = []
    database = "unavailable"
    latest = None
    try:
        async with connection() as conn:
            cursor = await conn.execute("SELECT job,heartbeat,last_success,status,rows_written FROM job_status ORDER BY job")
            jobs = [{key:value.isoformat() if isinstance(value,datetime) else value for key,value in row.items()} for row in await cursor.fetchall()]
            cursor = await conn.execute("SELECT max(time) AS latest FROM sensor_readings WHERE hazard='flood'")
            row = await cursor.fetchone()
            latest = row["latest"].isoformat() if row and row["latest"] else None
        database = "connected"
    except Exception:
        pass
    return {"api":"healthy","database":database,"hosting":os.getenv("HOSTING_PROVIDER","local development"),"jobs":jobs,"latest_flood_observation":latest,
       "integrations":{"gemini":"configured" if os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_MODEL") else "fallback",
        "backboard":"configured" if os.getenv("BACKBOARD_API_KEY") else "unavailable",
        "voice":"configured" if os.getenv("ELEVENLABS_API_KEY") and os.getenv("ELEVENLABS_VOICE_ID") else "unavailable"}}
