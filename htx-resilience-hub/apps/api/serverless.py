"""Run bounded, database-coordinated maintenance during serverless requests."""
from datetime import datetime, timedelta, timezone

from .db import connection
from .workers import ingest_flood, ingest_forecasts, evaluate_alerts, run_job


async def maintain(*, force_alerts: bool = False) -> None:
    # A transaction lock prevents parallel function instances duplicating jobs.
    async with connection() as conn:
        cursor = await conn.execute("SELECT pg_try_advisory_xact_lock(7262027) AS acquired")
        if not (await cursor.fetchone())["acquired"]:
            return
        cursor = await conn.execute("SELECT job,heartbeat FROM job_status")
        previous = {row["job"]: row["heartbeat"] for row in await cursor.fetchall()}
        now = datetime.now(timezone.utc)
        for name, callback, seconds in (
            ("flood_ingestion", ingest_flood, 900),
            ("forecast_ingestion", ingest_forecasts, 900),
            ("alert_evaluator", evaluate_alerts, 60),
        ):
            last = previous.get(name)
            if (force_alerts and name == "alert_evaluator") or last is None or now - last >= timedelta(seconds=seconds):
                await run_job(name, callback)
