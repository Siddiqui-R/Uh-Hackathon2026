"""Verify coordination and scheduling across separate function instances."""
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from apps.api.serverless import maintain


class MaintenanceTests(unittest.IsolatedAsyncioTestCase):
    async def run_maintenance(self, acquired, rows, force=False):
        cursor = AsyncMock()
        cursor.fetchone.return_value = {"acquired": acquired}
        cursor.fetchall.return_value = rows
        conn = AsyncMock()
        conn.execute.return_value = cursor

        @asynccontextmanager
        async def connection():
            yield conn

        with patch("apps.api.serverless.connection", connection), patch("apps.api.serverless.run_job", new_callable=AsyncMock) as job:
            await maintain(force_alerts=force)
            return [call.args[0] for call in job.call_args_list]

    async def test_concurrent_instance_skips_jobs(self):
        self.assertEqual(await self.run_maintenance(False, []), [])

    async def test_cold_instance_runs_missing_jobs(self):
        self.assertEqual(await self.run_maintenance(True, []),
                         ["flood_ingestion", "forecast_ingestion", "alert_evaluator"])

    async def test_recent_jobs_are_shared_across_instances(self):
        rows = [{"job": name, "heartbeat": datetime.now(timezone.utc)} for name in
                ["flood_ingestion", "forecast_ingestion", "alert_evaluator"]]
        self.assertEqual(await self.run_maintenance(True, rows), [])
        self.assertEqual(await self.run_maintenance(True, rows, force=True), ["alert_evaluator"])
