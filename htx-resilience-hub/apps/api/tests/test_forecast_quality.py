"""Provider -> normalized snapshot -> storage -> activity regression tests. No network/DB."""
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from apps.api.environment import forecast, save_forecast, CACHE, UH
from apps.api.forecast_quality import temperature_f
from apps.api.recommendations import build_recommendations, hour_for
from apps.api.tests.test_planner_recommendations import prefs, forecast as fixture, NOW, plan


class ForecastQualityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        CACHE.clear()

    async def snapshot(self, unit="°F", temperature=-27, feels=-38):
        at = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        weather = {"latitude": UH.lat, "longitude": UH.lon,
                   "hourly_units": {"temperature_2m": unit, "apparent_temperature": unit},
                   "hourly": {"time": [at.isoformat()], "temperature_2m": [temperature],
                              "apparent_temperature": [feels], "precipitation_probability": [0]}}
        air = {"hourly": {"time": [at.isoformat()], "us_aqi": [50], "pm2_5": [None]}}
        client = MagicMock()
        client.get = AsyncMock(side_effect=[httpx.Response(200, json=weather, request=httpx.Request("GET", "https://example.test/weather")),
                                            httpx.Response(200, json=air, request=httpx.Request("GET", "https://example.test/air"))])
        with patch("apps.api.environment.httpx.AsyncClient") as factory, patch("apps.api.environment.temporary_storage", return_value=True):
            factory.return_value.__aenter__.return_value = client
            result = await forecast(UH, force=True)
        self.assertEqual(client.get.call_args_list[0].kwargs["params"]["temperature_unit"], "fahrenheit")
        return result

    async def test_fahrenheit_negatives_preserved_and_flagged(self):
        result = await self.snapshot()
        hour = result["hours"][0]
        self.assertEqual((hour["temperature_2m"], hour["apparent_temperature"]), (-27, -38))
        self.assertEqual(hour["precipitation_probability"], 0)
        self.assertNotIn("pm2_5", hour)
        self.assertEqual(len(hour["data_quality_notes"]), 2)
        self.assertEqual(result["sources"]["weather"]["provider_units"]["temperature_2m"], "°F")

    async def test_celsius_is_converted_once_before_storage(self):
        result = await self.snapshot("°C", 30, 35)
        hour = result["hours"][0]
        self.assertEqual((hour["temperature_2m"], hour["apparent_temperature"]), (86, 95))
        self.assertEqual(hour["source_values"]["temperature_2m"], {"value": 30, "unit": "°C"})
        cursor = MagicMock(); cursor.executemany = AsyncMock()
        connection = MagicMock(); connection.cursor.return_value.__aenter__.return_value = cursor
        @asynccontextmanager
        async def connect():
            yield connection
        with patch("apps.api.environment.connection", connect):
            await save_forecast(UH, result)
        rows = cursor.executemany.call_args.args[1]
        temperature = next(row for row in rows if row[3] == "temperature_2m")
        self.assertEqual(temperature[4:6], (86, "F"))

    async def test_unknown_units_keep_raw_evidence_without_fahrenheit_label(self):
        result = await self.snapshot(None, 30, 35)
        hour = result["hours"][0]
        self.assertNotIn("temperature_2m", hour)
        self.assertEqual(hour["source_values"]["temperature_2m"]["value"], 30)
        self.assertIn("raw value 30", hour["data_quality_notes"][0])

    def test_invalid_values_are_missing(self):
        for value in [None, float("nan"), float("inf"), True, "30"]:
            self.assertIsNone(temperature_f(value, "°F"))

    def test_activity_shows_anomalous_source_without_positive_advice(self):
        data = fixture()
        data["hours"][0].update(temperature_2m=-27, apparent_temperature=-38)
        card = build_recommendations(prefs(), [data], [], NOW)[0]
        self.assertEqual(card["original_conditions"]["temperature_f"], -27)
        self.assertEqual(card["original_conditions"]["feels_like_f"], -38)
        self.assertEqual(card["status"], "data quality review")
        self.assertIsNone(card["alternative_time"])
        self.assertEqual(card["data_quality"][0]["forecast_hour"], data["hours"][0]["time"])

    def test_anomalous_alternative_is_skipped(self):
        data = fixture()
        data["hours"][0]["apparent_temperature"] = 100
        data["hours"][3]["apparent_temperature"] = -38
        card = build_recommendations(prefs(plan(duration_minutes=60)), [data], [], NOW)[0]
        self.assertEqual(card["alternative_time"], data["hours"][4]["time"])

    def test_stale_values_remain_visible_without_alternative(self):
        data = fixture(); data["retrieved_at"] = (NOW - timedelta(hours=2)).isoformat()
        card = build_recommendations(prefs(), [data], [], NOW)[0]
        self.assertEqual(card["forecast_status"], "stale")
        self.assertEqual(card["original_conditions"]["feels_like_f"], 85)
        self.assertIsNone(card["alternative_time"])

    def test_invalid_rain_probability_does_not_support_time_advice(self):
        data = fixture(); data["hours"][0]["precipitation_probability"] = -5
        card = build_recommendations(prefs(), [data], [], NOW)[0]
        self.assertEqual(card["original_conditions"]["precipitation_probability"], -5)
        self.assertEqual(card["status"], "data quality review")
        self.assertIsNone(card["alternative_time"])

    def test_hour_selection_uses_instant_not_browser_timezone(self):
        hours = fixture()["hours"]
        self.assertEqual(hour_for(hours, datetime.fromisoformat("2026-10-10T10:30:00-05:00")), hours[0])
        self.assertEqual(hour_for(hours, datetime.fromisoformat("2026-10-10T11:00:00-05:00")), hours[1])
