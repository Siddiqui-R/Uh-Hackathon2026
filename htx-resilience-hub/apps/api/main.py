"""Noach: environmental context, grounded AI, preferences and SSE."""
import asyncio
import hmac
import json
import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request, Query, Response
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

# Support both documented uvicorn entry points.
if not __package__:
    import sys
    from pathlib import Path
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from apps.api.config import require_env
from apps.api.auth import router as auth_router, session_user, account_user_id
from apps.api.db import connection
from apps.api.models import AskRequest, AskResponse, UserPrefs, HazardReading, AlertReadRequest
from apps.api.environment import hazards
from apps.api.conditions import area, geocode, point, in_limits
from apps.api.providers import gemini_answer, memory_get, memory_sync
from apps.api.service import briefing
from apps.api.store import get_prefs, save_prefs, alerts_after, persist_alert, set_alert_read, conversation_history, save_conversation_turn, demo_mode, temporary_storage, DEMO_ALERTS
from apps.api.recommendations import suggestions
from apps.api.anomaly_detection import detect_pm25, detect_rising_water
from apps.api.anomaly_store import anomalies_after, latest_anomalies, publish_anomaly

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if not temporary_storage():
        require_env("DATABASE_URL")
    if os.getenv("NOACH_ENV") == "production":
        require_env("INTERNAL_API_TOKEN")
    yield

app = FastAPI(title="Noach",version="0.3.0",lifespan=lifespan)
app.include_router(auth_router)

@app.middleware("http")
async def internal_access(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    token = os.getenv("INTERNAL_API_TOKEN","")
    if not token and (os.getenv("NOACH_ENV") == "production" or os.getenv("VERCEL")) and request.url.path != "/health":
        return JSONResponse({"detail":"Internal API token is not configured"},status_code=503)
    if token and request.url.path != "/health" and not hmac.compare_digest(request.headers.get("x-internal-token",""),token):
        return JSONResponse({"detail":"Internal API access required"},status_code=401)
    account_token = request.headers.get("x-account-session", "")
    if account_token:
        try:
            request.state.account = await session_user(account_token)
        except Exception:
            return JSONResponse({"detail":"Account session unavailable"},status_code=503)
        if not request.state.account:
            return JSONResponse({"detail":"Sign in again"},status_code=401)
    return await call_next(request)

@app.get("/health")
async def health() -> dict[str,str]:
    return {"status":"ok","service":"Noach","mode":"demo-enabled" if demo_mode() else "live"}

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

@app.get("/api/air/stations")
async def air_stations() -> list[dict]:
    if temporary_storage():
        return []
    try:
        async with connection() as conn:
            rows = await (await conn.execute("""SELECT DISTINCT ON (r.station_id)
                r.station_id,s.station_name,s.lat,s.lon,r.value,r.unit,r.time,r.source
                FROM sensor_readings r JOIN stations s USING(station_id)
                WHERE r.hazard='air' AND r.metric='PM2.5'
                ORDER BY r.station_id,r.time DESC""")).fetchall()
        return [{**row,"time":row["time"].isoformat(),
                 "fresh": datetime.now(timezone.utc)-row["time"] <= timedelta(hours=3)} for row in rows]
    except Exception:
        raise HTTPException(503,"Air monitoring stations unavailable")

@app.get("/api/anomalies")
async def anomaly_list() -> list[dict]:
    try:
        return await latest_anomalies()
    except Exception:
        raise HTTPException(503,"Anomaly history unavailable")

@app.get("/api/anomalies/stream")
async def anomaly_stream(request: Request, after: int = Query(default=0,ge=0)) -> StreamingResponse:
    try:
        cursor_id = max(after,int(request.headers.get("last-event-id","0")))
    except ValueError:
        cursor_id = after
    async def events() -> AsyncIterator[str]:
        nonlocal cursor_id
        yield 'event: ready\ndata: {"status":"connected"}\n\n'
        while not await request.is_disconnected():
            try:
                for event in await anomalies_after(cursor_id):
                    cursor_id = int(event["id"])
                    yield f"id: {cursor_id}\nevent: anomaly\ndata: {json.dumps(event)}\n\n"
            except Exception:
                yield 'event: status\ndata: {"status":"anomaly storage unavailable"}\n\n'
            yield ": heartbeat\n\n"
            await asyncio.sleep(5)
    return StreamingResponse(events(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

class SimulationRequest(BaseModel):
    kind: Literal["air", "flood"] = "air"
    user_id: str | None = None


@app.post("/api/demo/simulate-anomaly")
async def simulate_anomaly(http_request: Request, request: SimulationRequest | None = None) -> dict:
    if not demo_mode() and os.getenv("NOACH_ALLOW_SIMULATION", "false").lower() != "true":
        raise HTTPException(404,"Not found")
    target_user_id = account_user_id(http_request,request.user_id) if request and request.user_id else None
    kind = request.kind if request else "air"
    now = datetime.now(timezone.utc)
    if kind == "flood":
        history = [(now-timedelta(minutes=minutes), level) for minutes,level in
                   [(60,7.0),(45,7.2),(30,7.4),(15,7.7)]]
        finding = detect_rising_water(8.7, now, history, now)
        station = ("demo:whiteoak-gage", "Whiteoak Bayou demo gauge", 29.7752, -95.3972,
                   8.7, "flood", "Gage height, feet", "ft")
    else:
        baseline = [10,11,12,11,13,12,10,12]
        history = [(now-timedelta(hours=8-index), value) for index,value in enumerate(baseline)]
        finding = detect_pm25(52, now, history, now)
        station = ("demo:uh-pm25", "UH area demo monitor", 29.7199, -95.3422,
                   52, "air", "PM2.5", "µg/m³")
    if finding is None:
        raise HTTPException(500,"Simulation failed detection")
    try:
        station_id,station_name,lat,lon,value,hazard,metric,unit = station
        event = await publish_anomaly(station_id, station_name, lat, lon,
                                      now, value, finding, "Synthetic demonstration", simulated=True,
                                      hazard=hazard, metric=metric, unit=unit,
                                      target_user_id=target_user_id)
    except Exception:
        raise HTTPException(503,"Simulation requires the database and anomaly migration")
    return {"status":"detected", "event":event}
@app.get("/api/conditions/area")
async def conditions_area() -> dict:
    return await area()

@app.get("/api/geocode")
async def geocode_route(q: str = Query(min_length=3,max_length=200)) -> list[dict]:
    try:
        return await geocode(q)
    except Exception:
        raise HTTPException(503,"Address search is unavailable; tap the map or use your device location instead")

@app.get("/api/conditions/point")
async def conditions_point(request: Request, user_id: str = Query(min_length=1,max_length=100), lat: float = Query(), lon: float = Query()) -> dict:
    user_id = account_user_id(request,user_id)
    if not in_limits(lat,lon):
        raise HTTPException(422,"Map pins are limited to the greater Houston area")
    try:
        prefs,_ = await get_prefs(user_id)
        return await point(prefs,lat,lon)
    except Exception:
        raise HTTPException(503,"Conditions for this point are unavailable; please retry")

@app.get("/api/prefs")
async def preferences(request: Request, user_id: str = Query(min_length=1,max_length=100)) -> dict:
    user_id = account_user_id(request,user_id)
    try:
        prefs,storage = await get_prefs(user_id)
        return {"preferences":prefs.model_dump(mode="json"),"storage":storage,"planner_schema_version":2}
    except Exception:
        raise HTTPException(503,"Preferences unavailable; check database configuration and migrations")

@app.post("/api/prefs")
async def preferences_save(request: Request, prefs: UserPrefs) -> dict:
    account_user_id(request,prefs.user_id)
    try:
        storage = await save_prefs(prefs)
    except Exception:
        raise HTTPException(503,"Preferences could not be saved; no durable change was confirmed")
    memory = await memory_sync(prefs)
    return {"preferences":prefs.model_dump(mode="json"),"storage":storage,"memory":memory}

@app.get("/api/briefing")
async def briefing_route(request: Request, user_id: str = Query(min_length=1,max_length=100)) -> dict:
    user_id = account_user_id(request,user_id)
    try:
        if os.getenv("VERCEL"):
            from apps.api.serverless import maintain
            await maintain()
        return await briefing(user_id)
    except Exception:
        raise HTTPException(503,"Briefing unavailable; check database settings or explicitly enable NOACH_DEMO_MODE")

@app.post("/api/ask",response_model=AskResponse)
async def ask(payload: AskRequest, response: Response, request: Request) -> AskResponse:
    user_id = account_user_id(request,payload.user_id or "guest")
    try:
        context = await briefing(user_id)
        prefs,_ = await get_prefs(user_id)
        context["saved_preferences"] = prefs.model_dump(mode="json",exclude={"user_id"})
        history = await conversation_history(user_id,4) if user_id.startswith("acct:") else [turn.model_dump() for turn in payload.history]
        answer,provider = await gemini_answer(
            payload.question,context,await memory_get(prefs),
            history=[{"question":turn["question"],"answer":turn["answer"]} for turn in history],
        )
        await save_conversation_turn(user_id,payload.question,answer,provider)
        response.headers["X-AI-Provider"] = provider
        return AskResponse(answer=answer)
    except Exception:
        raise HTTPException(503,"Environmental context unavailable; please retry")


@app.get("/api/assistant/history")
async def assistant_history(request: Request, user_id: str = Query(min_length=1,max_length=100), before: int | None = Query(default=None,gt=0)) -> list[dict]:
    user_id = account_user_id(request,user_id)
    try:
        return await conversation_history(user_id,before_id=before)
    except Exception:
        raise HTTPException(503,"Conversation history unavailable")

@app.get("/api/alerts")
async def alert_stream(request: Request,user_id: str = Query(min_length=1,max_length=100),after: int = Query(default=0,ge=0)) -> StreamingResponse:
    user_id = account_user_id(request,user_id)
    account_token = request.headers.get("x-account-session", "")
    try:
        cursor_id = max(after,int(request.headers.get("last-event-id","0")))
    except ValueError:
        cursor_id = after
    async def events() -> AsyncIterator[str]:
        nonlocal cursor_id
        started = time.monotonic()
        yield 'event: ready\ndata: {"status":"connected"}\n\n'
        while not await request.is_disconnected():
            if account_token:
                try:
                    if not await session_user(account_token):
                        break
                except Exception:
                    break
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


@app.post("/api/alerts/read")
async def alert_read(request: Request, payload: AlertReadRequest) -> dict:
    account_user_id(request,payload.user_id)
    try:
        found, read_at = await set_alert_read(payload.user_id, payload.alert_id, payload.read)
    except Exception:
        raise HTTPException(503, "Alert history unavailable")
    if not found:
        raise HTTPException(404, "Alert not found")
    return {"id": str(payload.alert_id), "read_at": read_at}

@app.post("/api/alerts/demo")
async def demo_alert(request: Request, payload: AskRequest) -> dict:
    if not demo_mode() and os.getenv("NOACH_ALLOW_SIMULATION", "false").lower() != "true":
        raise HTTPException(404,"Not found")
    user_id = account_user_id(request,payload.user_id or "guest")
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
    database = "temporary memory" if temporary_storage() else "unavailable"
    latest = None
    if not temporary_storage():
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
        "airnow":"configured" if os.getenv("AIRNOW_API_KEY") else "unavailable",
        "backboard":"configured" if os.getenv("BACKBOARD_API_KEY") else "unavailable",
        "voice":"configured" if os.getenv("ELEVENLABS_API_KEY") and os.getenv("ELEVENLABS_VOICE_ID") else "unavailable"}}
