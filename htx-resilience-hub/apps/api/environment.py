"""Observed bayou data and attributed model forecasts."""
import asyncio
import hashlib
import math
from datetime import datetime, timedelta, timezone
from typing import Any
import httpx
from .db import connection
from .models import Location
from .store import demo_mode, temporary_storage
from .forecast_quality import TEMPERATURES, temperature_f, quality_notes

UTC = timezone.utc
UH = Location(id="uh",name="University of Houston",kind="school",lat=29.7199,lon=-95.3422)
CACHE: dict[str, tuple[datetime, dict[str, Any]]] = {}

def location_key(location: Location) -> str:
    return hashlib.sha256(f"{location.lat:.5f},{location.lon:.5f}".encode()).hexdigest()[:24]

def distance(a: Location, b: dict[str, Any]) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b["lat"])
    dlat, dlon = lat2-lat1, math.radians(b["lon"]-a.lon)
    hav = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371 * 2 * math.asin(min(1, math.sqrt(hav)))

def fresh(timestamp: str | datetime, now: datetime | None = None) -> bool:
    stamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00")) if isinstance(timestamp,str) else timestamp
    return stamp.tzinfo is not None and timedelta(0) <= (now or datetime.now(UTC))-stamp <= timedelta(minutes=60)

def public_hazards(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # No one-size-fits-all stage threshold is valid across USGS stations.
    return [{**row, "severity": "unrated", "time": row["time"].isoformat()} for row in rows]

async def hazards() -> tuple[list[dict[str, Any]], str]:
    try:
        if temporary_storage():
            raise RuntimeError("No database in temporary demo mode")
        async with connection() as conn:
            cursor = await conn.execute("""WITH latest AS (
              SELECT DISTINCT ON(station_id,metric) * FROM sensor_readings
              WHERE hazard='flood' ORDER BY station_id,metric,time DESC)
              SELECT l.*,s.station_name,s.lat,s.lon FROM latest l JOIN stations s USING(station_id)""")
            rows = await cursor.fetchall()
        return public_hazards(rows), "live" if rows else "unavailable"
    except Exception:
        if not demo_mode():
            return [], "unavailable"
        return [{"hazard":"flood","station_id":"08074500","station_name":"Whiteoak Bayou at Houston (demo)",
          "lat":29.7752,"lon":-95.3972,"metric":"Gage height, feet","value":7.71,"unit":"ft",
          "severity":"unrated","time":datetime.now(UTC).isoformat()}], "demo"

async def forecast(location: Location, force: bool = False) -> dict[str, Any]:
    key,now = location_key(location),datetime.now(UTC)
    cached = CACHE.get(key)
    if cached and not force and now-cached[0] < timedelta(minutes=15):
        # Share environmental values by coordinates, never another profile's place name or ID.
        return {**cached[1], "location":location.model_dump()}
    params = {"latitude":location.lat,"longitude":location.lon,"timezone":"UTC"}
    async with httpx.AsyncClient(timeout=30) as client:
        responses = await asyncio.gather(
            client.get("https://api.open-meteo.com/v1/forecast", params={**params,
                "hourly":"temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability",
                "temperature_unit":"fahrenheit","forecast_days":2}),
            client.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={**params,"hourly":"us_aqi,pm2_5","forecast_days":2}),
            return_exceptions=True)
    hours: dict[str, dict[str, Any]] = {}
    statuses: dict[str,str] = {}
    sources: dict[str, Any] = {}
    metrics = [("weather",["temperature_2m","relative_humidity_2m","apparent_temperature","precipitation_probability"]), ("air",["us_aqi","pm2_5"])]
    for result,(source,names) in zip(responses,metrics):
        if isinstance(result,BaseException):
            statuses[source] = "unavailable"
            continue
        try:
            result.raise_for_status()
            payload = result.json()
            hourly = payload["hourly"]
            units = payload.get("hourly_units", {})
            sources[source] = {"name": "Open-Meteo weather" if source == "weather" else "CAMS / Open-Meteo air quality",
                "url": "https://open-meteo.com/en/docs" if source == "weather" else "https://open-meteo.com/en/docs/air-quality-api",
                "retrieved_at": now.isoformat(), "provider_units": units,
                "latitude": payload.get("latitude"), "longitude": payload.get("longitude")}
            for index, timestamp in enumerate(hourly["time"]):
                at = datetime.fromisoformat(timestamp)
                at = at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC)
                if at < now.replace(minute=0,second=0,microsecond=0):
                    continue
                entry = hours.setdefault(at.isoformat(), {"time":at.isoformat()})
                for metric in names:
                    series = hourly.get(metric) or []
                    value = series[index] if index < len(series) else None
                    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                        continue
                    if metric in TEMPERATURES:
                        entry.setdefault("source_values", {})[metric] = {"value": value, "unit": units.get(metric)}
                        normalized = temperature_f(value, units.get(metric))
                        if normalized is None:
                            label = "temperature" if metric == "temperature_2m" else "feels-like temperature"
                            entry.setdefault("data_quality_notes", []).append(f"Open-Meteo {label}: raw value {value:g}, unit {units.get(metric) or 'not supplied'}. Fahrenheit could not be verified.")
                            continue
                        entry[metric] = normalized
                    else:
                        entry[metric] = float(value)
            statuses[source] = "live model"
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            statuses[source] = "unavailable"
    for hour in hours.values():
        hour["data_quality_notes"] = quality_notes(hour, location.lat, location.lon)
    snapshot = {"location":location.model_dump(),"retrieved_at":now.isoformat(),"hours":sorted(hours.values(),key=lambda h:h["time"]), "sources": sources,
                "source_status":statuses,"attribution":"Weather: Open-Meteo. Air quality: CAMS / Open-Meteo modeled forecasts, not a local sensor.",
                "source_url":"https://open-meteo.com/en/docs/air-quality-api","storage":"unavailable"}
    if any(s == "live model" for s in statuses.values()):
        if temporary_storage():
            snapshot["storage"] = "temporary (not persisted)"
        else:
            try:
                await save_forecast(location,snapshot)
                snapshot["storage"] = "database"
            except Exception:
                snapshot["storage"] = "unavailable"
    CACHE[key] = (now,snapshot)
    return snapshot

async def save_forecast(location: Location, snapshot: dict[str, Any]) -> int:
    units = {"temperature_2m":"F","apparent_temperature":"F","relative_humidity_2m":"%","precipitation_probability":"%","us_aqi":"US AQI","pm2_5":"µg/m³"}
    rows = [(snapshot["retrieved_at"],hour["time"],location_key(location),metric,value,units[metric],"Open-Meteo weather" if metric not in {"us_aqi","pm2_5"} else "CAMS / Open-Meteo")
            for hour in snapshot["hours"] for metric,value in hour.items() if metric in units]
    async with connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.executemany("INSERT INTO forecast_snapshots VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", rows)
    return len(rows)
