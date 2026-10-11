"""Activity-window regression checks using only modeled forecast fixtures."""
import unittest
import os
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from apps.api.main import app
from apps.api.models import Location, Routine, UserPrefs
from apps.api.recommendations import build_recommendations, next_activity
from apps.api.store import DEMO_PREFS, get_prefs, save_prefs
from apps.api.workers import alert_candidates

UTC = timezone.utc
NOW = datetime(2026, 10, 10, 14, 30, tzinfo=UTC)
PLACE = Location(id="park", name="Park", lat=29.72, lon=-95.34)


def plan(**changes):
    values = dict(id="walk", activity="Walk", location_id="park", local_time="10:00",
                  weekdays=list(range(7)), start_date="2026-10-10", recurrence="none",
                  duration_minutes=120, alerts_enabled=True)
    values.update(changes)
    return SimpleNamespace(**values)


def prefs(routine=None):
    profile = UserPrefs(user_id="demo", locations=[PLACE])
    return profile.model_copy(update={"routines": [routine or plan()]})


def forecast():
    return {"location": PLACE.model_dump(), "retrieved_at": NOW.isoformat(), "attribution": "Open-Meteo modeled forecast",
            "hours": [
                {"time": datetime(2026, 10, 10, hour, tzinfo=UTC).isoformat(),
                 "apparent_temperature": feels, "us_aqi": aqi, "precipitation_probability": rain}
                for hour, feels, aqi, rain in [
                    (15, 85, 50, 10), (16, 99, 110, 10), (17, 80, 40, 80),
                    (18, 82, 45, 10), (19, 81, 43, 10), (20, 82, 40, 10),
                ]]}


class PlannerRecommendationTests(unittest.TestCase):
    def test_database_json_round_trip_preserves_planner_fields(self):
        profile = UserPrefs(user_id="acct:planner-test", locations=[PLACE], routines=[
            Routine(id="walk", activity="Walk", location_id="park", local_time="10:00",
                    start_date="2026-10-10", recurrence="none", duration_minutes=120,
                    alerts_enabled=False)
        ])
        record = {}

        class Connection:
            async def execute(self, sql, params):
                if sql.startswith("INSERT INTO user_prefs"):
                    record["preferences"] = params[-1].obj
                return self

            async def fetchone(self):
                return {"preferences": record["preferences"]}

        @asynccontextmanager
        async def connection():
            yield Connection()

        async def round_trip():
            self.assertEqual(await save_prefs(profile), "database")
            return await get_prefs(profile.user_id)

        with patch.dict(os.environ, {"NOACH_DEMO_MODE": "false"}), patch("apps.api.store.connection", connection):
            restored, storage = asyncio.run(round_trip())
        self.assertEqual(storage, "database")
        self.assertEqual(restored.model_dump(mode="json"), profile.model_dump(mode="json"))
        with self.assertRaises(ValueError):
            next_activity(restored.routines[0], restored, datetime(2026, 10, 11, 14, 30, tzinfo=UTC))
        self.assertEqual(build_recommendations(restored, [forecast()], [], datetime(2026, 10, 11, 14, 30, tzinfo=UTC)), [])

    def test_planner_fields_round_trip_through_preferences_api(self):
        payload = UserPrefs(user_id="planner-test", locations=[PLACE], routines=[
            Routine(id="walk", activity="Walk", location_id="park", local_time="10:00",
                    start_date="2026-10-10", recurrence="none", duration_minutes=120,
                    alerts_enabled=False)
        ]).model_dump(mode="json")
        with patch.dict(os.environ, {"NOACH_DEMO_MODE": "true", "NOACH_DEMO_STORAGE": "memory",
                                  "NOACH_ENV": "development", "INTERNAL_API_TOKEN": ""}), \
             patch("apps.api.main.memory_sync", new=AsyncMock(return_value="disabled")):
            DEMO_PREFS.pop("planner-test", None)
            try:
                with TestClient(app) as client:
                    saved = client.post("/api/prefs", json=payload)
                    self.assertEqual(saved.status_code, 200)
                    self.assertEqual(saved.json()["preferences"]["routines"], payload["routines"])
                    loaded = client.get("/api/prefs?user_id=planner-test")
                    self.assertEqual(loaded.status_code, 200)
                    self.assertEqual(loaded.json()["planner_schema_version"], 2)
                    self.assertEqual(loaded.json()["preferences"]["routines"], payload["routines"])
                    restored = UserPrefs.model_validate(loaded.json()["preferences"])
                    self.assertEqual(build_recommendations(restored, [forecast()], [], NOW)[0]["duration_minutes"], 120)
                    self.assertEqual(alert_candidates(restored, [forecast()], NOW), [])
                    restored.routines[0].alerts_enabled = True
                    self.assertEqual({item[1]["hazard"] for item in alert_candidates(restored, [forecast()], NOW)},
                                     {"heat", "air"})
            finally:
                DEMO_PREFS.pop("planner-test", None)

    def test_legacy_weekly_routines_and_one_time_validation(self):
        legacy = Routine(id="walk", activity="Walk", location_id="park", local_time="10:00")
        self.assertIsNone(legacy.start_date)
        self.assertEqual(legacy.recurrence, "weekly")
        self.assertTrue(legacy.alerts_enabled)
        self.assertEqual(legacy.duration_minutes, 60)
        with self.assertRaises(ValidationError):
            Routine(id="walk", activity="Walk", location_id="park", local_time="10:00", recurrence="none")

    def test_one_time_date_and_expiry(self):
        routine = plan()
        self.assertEqual(next_activity(routine, prefs(routine), NOW), datetime(2026, 10, 10, 15, tzinfo=UTC))
        with self.assertRaises(ValueError):
            next_activity(routine, prefs(routine), datetime(2026, 10, 10, 16, tzinfo=UTC))

    def test_full_duration_and_rain_exclude_bad_alternatives(self):
        profile = prefs()
        card = build_recommendations(profile, [forecast()], [], NOW)[0]
        self.assertEqual(card["status"], "consider alternatives")
        self.assertEqual(card["alternative_time"], datetime(2026, 10, 10, 18, tzinfo=UTC).isoformat())
        self.assertIn("120-minute activity", card["reason"])
        self.assertEqual(card["forecast_status"], "current")

    def test_alert_opt_out_and_past_one_time_plan(self):
        muted = plan(alerts_enabled=False)
        self.assertEqual(alert_candidates(prefs(muted), [forecast()], NOW), [])
        expired = plan(start_date="2026-10-09")
        self.assertEqual(alert_candidates(prefs(expired), [forecast()], NOW), [])
        self.assertEqual(build_recommendations(prefs(expired), [forecast()], [], NOW), [])


if __name__ == "__main__":
    unittest.main()


class DemoBriefingTests(unittest.TestCase):
    def test_demo_briefing_is_stateless_and_bounded(self):
        payload = UserPrefs(user_id="demo_browser", locations=[PLACE], routines=[
            Routine(id="walk", activity="Walk", location_id="park", local_time="10:00")]).model_dump(mode="json")
        with patch.dict(os.environ, {"NOACH_DEMO_MODE": "true", "NOACH_DEMO_STORAGE": "memory",
                                  "NOACH_ENV": "development", "INTERNAL_API_TOKEN": ""}), \
             patch("apps.api.main.briefing_for", new=AsyncMock(return_value={"recommendations": []})) as built, \
             patch("apps.api.main.get_prefs", new=AsyncMock()) as loaded, \
             patch("apps.api.main.save_prefs", new=AsyncMock()) as saved:
            with TestClient(app) as client:
                self.assertEqual(client.post("/api/demo/briefing", json=payload).status_code, 200)
                self.assertFalse(built.await_args.kwargs["persist"])
                self.assertEqual(client.post("/api/demo/briefing", json={**payload, "user_id": "acct:1"}).status_code, 404)
                far = {**payload, "locations": [{**payload["locations"][0], "lat": 40.7, "lon": -74.0}]}
                self.assertEqual(client.post("/api/demo/briefing", json=far).status_code, 422)
            loaded.assert_not_awaited()
            saved.assert_not_awaited()
            self.assertEqual(built.await_count, 1)
