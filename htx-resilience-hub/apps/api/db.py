"""Tiger Data / TimescaleDB access using psycopg 3 async connections."""
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
import psycopg
from psycopg.rows import dict_row

if __package__:
    from .config import require_env
else:
    from config import require_env


@asynccontextmanager
async def connection() -> AsyncIterator[psycopg.AsyncConnection]:
    # TODO: Add an async connection pool and production connection timeouts.
    async with await psycopg.AsyncConnection.connect(
        require_env("DATABASE_URL"), row_factory=dict_row, connect_timeout=10
    ) as conn:
        yield conn
