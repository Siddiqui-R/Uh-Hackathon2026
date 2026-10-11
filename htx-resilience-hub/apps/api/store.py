"""Async persistence; only explicit demo mode uses isolated process memory."""
import os
from datetime import datetime, timezone
from typing import Any
from psycopg.types.json import Jsonb
from .db import connection
from .models import UserPrefs

DEMO_PREFS: dict[str, UserPrefs] = {}
DEMO_ALERTS: list[dict[str, Any]] = []
DEMO_ALERT_KEYS: set[str] = set()

def demo_mode() -> bool:
    return os.getenv("NOACH_DEMO_MODE", "false").lower() == "true"

def temporary_storage() -> bool:
    """Explicit, development-only process memory for a database-free rehearsal."""
    return demo_mode() and os.getenv("NOACH_ENV") != "production" and os.getenv("NOACH_DEMO_STORAGE") == "memory"

async def get_prefs(user_id: str) -> tuple[UserPrefs, str]:
    if temporary_storage():
        return DEMO_PREFS.get(user_id, UserPrefs(user_id=user_id)), "temporary memory"
    try:
        async with connection() as conn:
            cursor = await conn.execute("SELECT preferences FROM user_prefs WHERE user_id=%s", (user_id,))
            row = await cursor.fetchone()
            return (UserPrefs.model_validate(row["preferences"]) if row and row["preferences"] else UserPrefs(user_id=user_id)), "database"
    except Exception:
        if not demo_mode():
            raise
        return DEMO_PREFS.get(user_id, UserPrefs(user_id=user_id)), "demo (temporary)"

async def save_prefs(prefs: UserPrefs) -> str:
    if temporary_storage():
        DEMO_PREFS[prefs.user_id] = prefs.model_copy(deep=True)
        return "temporary memory"
    try:
        async with connection() as conn:
            await conn.execute("""INSERT INTO user_prefs (user_id, home_lat, home_lon, work_lat, work_lon, thresholds, preferences)
                VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (user_id) DO UPDATE SET
                home_lat=EXCLUDED.home_lat, home_lon=EXCLUDED.home_lon, work_lat=EXCLUDED.work_lat,
                work_lon=EXCLUDED.work_lon, thresholds=EXCLUDED.thresholds, preferences=EXCLUDED.preferences""",
                (prefs.user_id, prefs.home_lat, prefs.home_lon, prefs.work_lat, prefs.work_lon,
                 Jsonb(prefs.thresholds), Jsonb(prefs.model_dump(mode="json"))))
        return "database"
    except Exception:
        if not demo_mode():
            raise
        DEMO_PREFS[prefs.user_id] = prefs.model_copy(deep=True)
        return "demo (temporary)"

async def job_update(job: str, status: str, rows: int = 0) -> None:
    async with connection() as conn:
        await conn.execute("""INSERT INTO job_status(job,status,rows_written,last_success)
          VALUES (%s,%s,%s,CASE WHEN %s='ok' THEN now() ELSE NULL END)
          ON CONFLICT(job) DO UPDATE SET heartbeat=now(),status=EXCLUDED.status,
          rows_written=EXCLUDED.rows_written,last_success=CASE WHEN EXCLUDED.status='ok' THEN now() ELSE job_status.last_success END""",
          (job, status, rows, status))

async def persist_alert(key: str, payload: dict[str, Any]) -> bool:
    if temporary_storage():
        if key in DEMO_ALERT_KEYS:
            return False
        DEMO_ALERT_KEYS.add(key)
        item = payload.copy()
        item["id"] = str(len(DEMO_ALERTS) + 1)
        item["read_at"] = None
        DEMO_ALERTS.append(item)
        return True
    async with connection() as conn:
        cursor = await conn.execute("""INSERT INTO alert_events(dedup_key,user_id,payload)
            VALUES (%s,%s,%s) ON CONFLICT(dedup_key) DO NOTHING RETURNING id""",
            (key, payload["user_id"], Jsonb(payload)))
        row = await cursor.fetchone()
        if not row:
            return False
        payload["id"] = str(row["id"])
        await conn.execute("UPDATE alert_events SET payload=%s WHERE id=%s", (Jsonb(payload), row["id"]))
        await conn.execute("INSERT INTO alerts(time,user_id,hazard,severity,message,channel) VALUES (%s,%s,%s,%s,%s,%s)",
            (payload["time"],payload["user_id"],payload["hazard"],payload["severity"],payload["message"],payload["channel"]))
        return True

async def alerts_after(user_id: str, cursor_id: int) -> list[dict[str, Any]]:
    if temporary_storage():
        return [a for a in DEMO_ALERTS if a["user_id"] == user_id and int(a["id"]) > cursor_id]
    try:
        async with connection() as conn:
            # Preserve earlier fixed-height alerts for audit, but do not replay
            # them after removing the unsupported station-wide stage rule.
            cursor = await conn.execute("""SELECT payload,read_at FROM alert_events
                WHERE user_id=%s AND id>%s AND dedup_key NOT LIKE 'flood-state:%%'
                ORDER BY id LIMIT 100""", (user_id,cursor_id))
            return [{**row["payload"], "read_at":row["read_at"].isoformat() if row["read_at"] else None}
                    for row in await cursor.fetchall()]
    except Exception:
        if not demo_mode():
            raise
        return [a for a in DEMO_ALERTS if a["user_id"] == user_id and int(a["id"]) > cursor_id]


async def set_alert_read(user_id: str, alert_id: int, read: bool) -> tuple[bool, str | None]:
    if temporary_storage():
        for alert in DEMO_ALERTS:
            if alert["user_id"] == user_id and int(alert["id"]) == alert_id:
                alert["read_at"] = (alert.get("read_at") or datetime.now(timezone.utc).isoformat()) if read else None
                return True, alert["read_at"]
        return False, None
    async with connection() as conn:
        row = await (await conn.execute("""UPDATE alert_events
            SET read_at=CASE WHEN %s THEN COALESCE(read_at,now()) ELSE NULL END
            WHERE id=%s AND user_id=%s AND dedup_key NOT LIKE 'flood-state:%%'
            RETURNING read_at""", (read, alert_id, user_id))).fetchone()
    if not row:
        return False, None
    return True, row["read_at"].isoformat() if row["read_at"] else None
