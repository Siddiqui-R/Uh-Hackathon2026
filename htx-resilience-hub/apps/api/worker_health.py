"""Container health check for alert-worker heartbeat, without exposing profiles."""
from datetime import datetime, timezone, timedelta
import psycopg
from .config import require_env

def main() -> int:
    with psycopg.connect(require_env("DATABASE_URL"),connect_timeout=5) as conn:
        row = conn.execute("SELECT heartbeat,status FROM job_status WHERE job='alert_evaluator'").fetchone()
    return 0 if row and row[1]=="ok" and datetime.now(timezone.utc)-row[0] < timedelta(minutes=3) else 1

if __name__ == "__main__":
    raise SystemExit(main())
