"""Persist anomaly evidence, stream it, and notify nearby saved profiles."""
from datetime import datetime, timezone
from typing import Any

from .anomaly_detection import Finding
from .db import connection
from .models import UserPrefs
from .environment import distance
from .recommendations import suggestions
from .store import DEMO_PREFS, persist_alert, temporary_storage

DEMO_ANOMALIES: list[dict[str, Any]] = []


def serialize(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value.isoformat() if isinstance(value, datetime) else value for key, value in row.items()}


async def anomalies_after(after: int = 0, limit: int = 30) -> list[dict[str, Any]]:
    if temporary_storage():
        return [event.copy() for event in DEMO_ANOMALIES if event["id"] > after][:limit]
    async with connection() as conn:
        rows = await (await conn.execute("""SELECT * FROM environmental_anomalies
            WHERE id > %s ORDER BY id LIMIT %s""", (after, limit))).fetchall()
    return [serialize(row) for row in rows]


async def latest_anomalies(limit: int = 20) -> list[dict[str, Any]]:
    if temporary_storage():
        return [event.copy() for event in reversed(DEMO_ANOMALIES[-limit:])]
    async with connection() as conn:
        rows = await (await conn.execute("""SELECT * FROM environmental_anomalies
            ORDER BY id DESC LIMIT %s""", (limit,))).fetchall()
    return [serialize(row) for row in rows]


async def publish_anomaly(station_id: str, station_name: str, lat: float, lon: float,
                          observed_at: datetime, value: float, finding: Finding, source: str,
                          simulated: bool, *, hazard: str = "air", metric: str = "PM2.5",
                          unit: str = "µg/m³", target_user_id: str | None = None) -> dict[str, Any] | None:
    if temporary_storage() and simulated:
        event = {"id": len(DEMO_ANOMALIES) + 1, "station_id": station_id, "station_name": station_name,
                 "lat": lat, "lon": lon, "hazard": hazard, "metric": metric, "value": value,
                 "unit": unit, "baseline": finding.baseline, "sample_count": finding.sample_count,
                 "score": finding.score, "method": finding.method, "severity": finding.severity,
                 "status": "unverified sensor anomaly", "observed_at": observed_at.isoformat(),
                 "detected_at": datetime.now(timezone.utc).isoformat(), "source": source,
                 "is_simulated": True}
        DEMO_ANOMALIES.append(event)
        await notify_nearby(event, target_user_id)
        return event.copy()
    async with connection() as conn:
        row = await (await conn.execute("""INSERT INTO environmental_anomalies
            (station_id,station_name,lat,lon,hazard,metric,value,unit,baseline,sample_count,
             score,method,severity,observed_at,source,is_simulated)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(station_id,metric,observed_at,is_simulated) DO NOTHING
            RETURNING *""", (station_id, station_name, lat, lon, hazard, metric, value, unit, finding.baseline,
                               finding.sample_count, finding.score, finding.method, finding.severity,
                               observed_at, source, simulated))).fetchone()
    if not row:
        return None
    event = serialize(row)
    await notify_nearby(event, target_user_id)
    return event


async def notify_nearby(event: dict[str, Any], target_user_id: str | None = None) -> None:
    station = {"lat": event["lat"], "lon": event["lon"]}
    if temporary_storage():
        rows = [{"preferences": prefs.model_dump(mode="json")} for prefs in DEMO_PREFS.values()]
    else:
        async with connection() as conn:
            rows = await (await conn.execute("SELECT preferences FROM user_prefs WHERE preferences <> '{}'::jsonb")).fetchall()
    for row in rows:
        try:
            profile = UserPrefs.model_validate(row["preferences"])
        except ValueError:
            continue
        if target_user_id and profile.user_id != target_user_id:
            continue
        if event["is_simulated"] and profile.user_id.startswith("acct:") and target_user_id != profile.user_id:
            continue
        nearby = next((place for place in profile.locations if distance(place, station) <= 10), None)
        if not nearby:
            continue
        prefix = "DEMO: " if event["is_simulated"] else ""
        if event["hazard"] == "flood":
            message = (f"{prefix}Rapid gage-height rise at {event['station_name']} near {nearby.name}: "
                       f"{event['baseline']:.2f} to {event['value']:.2f} ft, about "
                       f"{event['score']:.2f} ft/hour. This unverified station trend is not "
                       "an official flood warning and does not establish road safety.")
        else:
            message = (f"{prefix}Unusual PM2.5 reading at {event['station_name']} near {nearby.name}: "
                       f"{event['value']:.1f} µg/m³ versus a recent station average of "
                       f"{event['baseline']:.1f} µg/m³. This is an unverified sensor anomaly, "
                       "not a confirmed emergency. Check current conditions before outdoor plans.")
        await persist_alert(f"anomaly:{event['id']}:{profile.user_id}", {
            "id": "0", "time": datetime.now(timezone.utc).isoformat(), "user_id": profile.user_id,
            "hazard": event["hazard"], "severity": event["severity"], "message": message,
            "channel": "dashboard", "location_id": nearby.id, "station_id": event["station_id"],
            "suggestions": suggestions(event["hazard"]), "demo": event["is_simulated"],
        })
