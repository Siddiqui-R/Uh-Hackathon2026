"""Fetch Houston USGS instantaneous readings once and persist them to TimescaleDB."""
from datetime import datetime, timezone
import math
import os
import sys
from typing import Any

import psycopg
import requests

# Cron (export DATABASE_URL in the scheduler environment):
# */15 * * * * /usr/bin/python3 /path/to/flood.py
SITES: tuple[str, ...] = ("08074500", "08074000", "08075000")
USGS_URL = "https://waterservices.usgs.gov/nwis/iv/"
PARAMETER_CODES = "00065,00060,00045"
ReadingRow = tuple[datetime, str, str, str, float, str]
INSERT_SQL = """
    WITH claimed AS (
    INSERT INTO reading_identities(time,station_id,hazard,metric)
    VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING 1)
    INSERT INTO sensor_readings(time,station_id,hazard,metric,value,unit)
    SELECT %s,%s,%s,%s,%s,%s FROM claimed
"""


def parse_readings(payload: dict[str, Any]) -> list[ReadingRow]:
    """Normalize all returned samples, omitting missing or invalid numeric values."""
    rows: list[ReadingRow] = []
    for series in payload["value"]["timeSeries"]:
        station_id = series["sourceInfo"]["siteCode"][0]["value"]
        metric = series["variable"]["variableName"]
        unit = series["variable"]["unit"]["unitCode"]
        for block in series["values"]:
            for sample in block["value"]:
                try:
                    value = float(sample["value"])
                except (ValueError, TypeError):
                    continue
                if value == -999999 or not math.isfinite(value):
                    continue
                timestamp = datetime.fromisoformat(sample["dateTime"].replace("Z", "+00:00"))
                if timestamp.tzinfo is None:
                    raise ValueError("USGS reading timestamp is missing a timezone")
                rows.append((timestamp, station_id, "flood", metric, value, unit))
    return rows


STATIONS: dict[str, tuple[str, str, float, float]] = {}

def fetch_readings() -> list[ReadingRow]:
    """Fetch once; propagate HTTP, network, JSON, and response-shape failures."""
    with requests.get(
        USGS_URL,
        params={
            "format": "json",
            "sites": ",".join(SITES),
            "parameterCd": PARAMETER_CODES,
            "siteStatus": "all",
        },
        timeout=30,
    ) as response:
        response.raise_for_status()
        payload = response.json()
        STATIONS.clear()
        for series in payload["value"]["timeSeries"]:
            source = series["sourceInfo"]
            code = source["siteCode"][0]["value"]
            geo = source["geoLocation"]["geogLocation"]
            STATIONS[code] = (code,source["siteName"],float(geo["latitude"]),float(geo["longitude"]))
        return parse_readings(payload)


def write_readings(database_url: str, rows: list[ReadingRow]) -> int:
    """Commit the batch together; connection context rolls back on any failure."""
    with psycopg.connect(database_url, connect_timeout=30) as conn:
        with conn.cursor() as cursor:
            if STATIONS:
                cursor.executemany("INSERT INTO stations VALUES (%s,%s,%s,%s) ON CONFLICT(station_id) DO UPDATE SET station_name=EXCLUDED.station_name,lat=EXCLUDED.lat,lon=EXCLUDED.lon",list(STATIONS.values()))
            cursor.executemany(INSERT_SQL, [row[:4] + row for row in rows])
            count = cursor.rowcount
            cursor.execute("""INSERT INTO job_status(job,status,rows_written,last_success) VALUES ('flood_ingestion','ok',%s,now())
              ON CONFLICT(job) DO UPDATE SET heartbeat=now(),last_success=now(),status='ok',rows_written=EXCLUDED.rows_written""",(count,))
    return count


def main() -> int:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 1

    try:
        rows = fetch_readings()
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError) as exc:
        print(f"USGS fetch or response parsing failed: {exc}", file=sys.stderr)
        return 1

    try:
        count = write_readings(database_url, rows)
    except (psycopg.Error, ValueError) as exc:
        # Avoid echoing connection details, which can contain credentials.
        print(
            f"Database insert failed ({type(exc).__name__}); check DATABASE_URL, connectivity, and sensor_readings schema.",
            file=sys.stderr,
        )
        return 1

    print(f"Wrote {count} flood readings at {datetime.now(timezone.utc).isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
