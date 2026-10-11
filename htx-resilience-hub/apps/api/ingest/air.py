"""Hourly Houston PM2.5 monitoring-site observations from AirNow.

Requires AIRNOW_API_KEY. Observations stay separate from modeled AQI forecasts.
"""
import asyncio
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..anomaly_detection import detect_pm25
from ..anomaly_store import publish_anomaly
from ..db import connection
from ..config import require_env

AIRNOW_URL = "https://www.airnowapi.org/aq/data/"
HOUSTON_BBOX = "-95.85,29.35,-94.95,30.25"
QUERY_WINDOW = timedelta(hours=27)
LIVE_WINDOW = timedelta(hours=3)


@dataclass(frozen=True)
class AirReading:
    station_id: str
    station_name: str
    lat: float
    lon: float
    observed_at: datetime
    value: float


def parse_readings(payload: Any) -> list[AirReading]:
    if not isinstance(payload, list):
        raise ValueError("AirNow returned an unexpected response")
    readings: list[AirReading] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        row = {str(key).lower(): value for key, value in item.items()}
        try:
            if str(row.get("parameter", "")).upper().replace(".", "") != "PM25":
                continue
            unit = str(row.get("unit", "")).upper().replace(" ", "")
            if unit not in {"UG/M3", "µG/M³", "ΜG/M³"}:
                continue
            # Monitoring-site responses use AQSCode field names in some formats;
            # site metadata uses AQSID/FullAQSID. Accept either stable identifier.
            station_id = str(row.get("aqsid") or row.get("fullaqscode")
                             or row.get("fullaqsid") or row.get("intlaqscode") or "").strip()
            station_name = str(row.get("sitename") or "").strip()
            lat, lon, value = float(row["latitude"]), float(row["longitude"]), float(row["value"])
            stamp = datetime.fromisoformat(str(row["utc"]).replace("Z", "+00:00"))
            # AirNow labels this field UTC even when its string has no offset.
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            if (not station_id or not station_name or not math.isfinite(value)
                    or value < 0 or not 29.35 <= lat <= 30.25 or not -95.85 <= lon <= -94.95):
                continue
            readings.append(AirReading("airnow:" + station_id, station_name, lat, lon,
                                       stamp.astimezone(timezone.utc), value))
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return sorted(readings, key=lambda reading: reading.observed_at)


async def fetch_readings(key: str, now: datetime) -> list[AirReading]:
    params = {
        # One bounded Houston query each hour also seeds the 24-hour station
        # baseline on first startup; only fresh samples can trigger an event.
        "startDate": (now - QUERY_WINDOW).strftime("%Y-%m-%dT%H"),
        "endDate": now.strftime("%Y-%m-%dT%H"),
        "parameters": "PM25", "BBOX": HOUSTON_BBOX, "dataType": "C",
        "format": "application/json", "verbose": "1", "monitorType": "0",
        "includerawconcentrations": "1", "API_KEY": key,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(AIRNOW_URL, params=params)
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise ValueError("AirNow did not return JSON; check the API key and query") from exc
    return parse_readings(payload)


async def poll_air() -> int:
    key = os.getenv("AIRNOW_API_KEY", "").strip()
    if not key:
        return 0
    now = datetime.now(timezone.utc)
    readings = await fetch_readings(key, now)
    written = 0
    events = []
    # Keep the backfill in one transaction. Later readings can see earlier
    # samples from this response without opening a connection per record.
    async with connection() as conn:
        for reading in readings:
            age = now - reading.observed_at
            if not timedelta(0) <= age <= QUERY_WINDOW:
                continue
            claimed = await (await conn.execute("""INSERT INTO reading_identities(time,station_id,hazard,metric)
                VALUES (%s,%s,'air','PM2.5') ON CONFLICT DO NOTHING RETURNING 1""",
                (reading.observed_at, reading.station_id))).fetchone()
            if not claimed:
                continue
            await conn.execute("""INSERT INTO stations(station_id,station_name,lat,lon,source)
                VALUES (%s,%s,%s,%s,'AirNow') ON CONFLICT(station_id) DO UPDATE SET
                station_name=EXCLUDED.station_name,lat=EXCLUDED.lat,lon=EXCLUDED.lon,source=EXCLUDED.source""",
                (reading.station_id, reading.station_name, reading.lat, reading.lon))
            prior = []
            if age <= LIVE_WINDOW:
                prior = await (await conn.execute("""SELECT time,value FROM sensor_readings
                    WHERE station_id=%s AND metric='PM2.5' AND unit='µg/m³'
                    AND time >= %s AND time < %s ORDER BY time DESC LIMIT 48""",
                    (reading.station_id, reading.observed_at - timedelta(hours=24), reading.observed_at))).fetchall()
            await conn.execute("""INSERT INTO sensor_readings(time,station_id,hazard,metric,value,unit,source)
                VALUES (%s,%s,'air','PM2.5',%s,'µg/m³','AirNow')""",
                (reading.observed_at, reading.station_id, reading.value))
            written += 1
            if prior:
                finding = detect_pm25(reading.value, reading.observed_at,
                                      [(row["time"], row["value"]) for row in prior], now)
                if finding:
                    events.append((reading, finding))
    for reading, finding in events:
        await publish_anomaly(reading.station_id, reading.station_name, reading.lat, reading.lon,
                              reading.observed_at, reading.value, finding, "AirNow", simulated=False)
    return written


async def check_provider() -> None:
    """Read-only connection check; never prints the API key or writes to Tiger Data."""
    now = datetime.now(timezone.utc)
    readings = await fetch_readings(require_env("AIRNOW_API_KEY"), now)
    fresh = [reading for reading in readings if timedelta(0) <= now-reading.observed_at <= LIVE_WINDOW]
    print(json.dumps({"provider": "AirNow", "pm25_readings": len(readings),
                      "fresh_readings": len(fresh),
                      "stations": len({reading.station_id for reading in fresh}),
                      "newest_observation": max((reading.observed_at.isoformat() for reading in readings),
                                                default=None)}))


if __name__ == "__main__":
    try:
        asyncio.run(check_provider())
    except Exception as exc:
        # HTTP errors may include a URL containing the API key. Keep CLI logs safe.
        print(json.dumps({"provider": "AirNow", "status": "error",
                          "error_type": type(exc).__name__}))
        raise SystemExit(1) from None
