"""Apply pending SQL migrations once under a database advisory lock."""
from pathlib import Path
import psycopg
from .config import require_env

def main() -> None:
    with psycopg.connect(require_env("DATABASE_URL"),connect_timeout=30) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(7262026)")
        conn.execute("CREATE TABLE IF NOT EXISTS noach_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())")
        for path in sorted((Path(__file__).resolve().parents[2]/"db/migrations").glob("*.sql")):
            if conn.execute("SELECT 1 FROM noach_migrations WHERE name=%s",(path.name,)).fetchone():
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO noach_migrations(name) VALUES (%s)",(path.name,))
            print(f"Applied {path.name}")

if __name__ == "__main__":
    main()
