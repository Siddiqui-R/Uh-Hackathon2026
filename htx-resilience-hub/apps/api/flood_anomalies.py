"""Evaluate fresh USGS gage-height changes after the flood ingestion job."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from .anomaly_detection import detect_rising_water
from .anomaly_store import publish_anomaly
from .db import connection


async def detect_flood_anomalies(now: datetime | None = None) -> int:
    current_time = now or datetime.now(timezone.utc)
    async with connection() as conn:
        rows = await (await conn.execute("""SELECT DISTINCT ON (r.station_id,r.metric,r.time)
            r.station_id,s.station_name,s.lat,s.lon,r.metric,r.time,r.value
            FROM sensor_readings r JOIN stations s USING(station_id)
            WHERE r.hazard='flood' AND r.unit='ft'
              AND lower(r.metric) LIKE '%%gage height%%'
              AND r.time BETWEEN %s AND %s
            ORDER BY r.station_id,r.metric,r.time""",
            (current_time - timedelta(hours=3), current_time))).fetchall()
    series: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        series[(row["station_id"], row["metric"])].append(row)
    published = 0
    for samples in series.values():
        for index, sample in enumerate(samples):
            if current_time - sample["time"] > timedelta(hours=1):
                continue
            finding = detect_rising_water(sample["value"], sample["time"],
                [(prior["time"], prior["value"]) for prior in samples[:index]], current_time)
            if not finding:
                continue
            # One event per rising episode, except when a watch escalates to warning.
            async with connection() as conn:
                earlier = await (await conn.execute("""SELECT severity FROM environmental_anomalies
                    WHERE station_id=%s AND hazard='flood' AND is_simulated=false
                      AND observed_at BETWEEN %s AND %s
                    ORDER BY observed_at DESC LIMIT 1""",
                    (sample["station_id"], sample["time"] - timedelta(hours=2), sample["time"]))).fetchone()
            if earlier and (earlier["severity"] == "warning" or finding.severity == "watch"):
                continue
            event = await publish_anomaly(sample["station_id"], sample["station_name"],
                sample["lat"], sample["lon"], sample["time"], sample["value"],
                finding, "USGS", simulated=False, hazard="flood", metric=sample["metric"], unit="ft")
            if event:
                published += 1
    return published
