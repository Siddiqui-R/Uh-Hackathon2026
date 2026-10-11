"""Layer provenance and threshold explanations use only fixture evidence."""
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
from apps.api import conditions
from apps.api.recommendations import build_recommendations
from apps.api.tests.test_planner_recommendations import prefs, forecast, NOW


class PlanningLayerTests(unittest.IsolatedAsyncioTestCase):
    async def test_current_layer_retains_valid_time_and_normalizes_declared_units(self):
        payload = [{"current":{"time":"2026-10-11T12:15","apparent_temperature":30,"precipitation_probability":0},
                    "current_units":{"apparent_temperature":"°C"}}]
        response = httpx.Response(200,json=payload,request=httpx.Request("GET","https://example.test"))
        client = MagicMock(); client.get = AsyncMock(return_value=response)
        rows = await conditions.fetch_layer(client,"weather",{},1)
        self.assertEqual(rows[0]["apparent_temperature"],86)
        self.assertEqual(rows[0]["precipitation_probability"],0)
        self.assertEqual(rows[0]["valid_at"]["weather"],"2026-10-11T12:15:00+00:00")
        self.assertEqual(rows[0]["source_values"]["apparent_temperature"],{"value":30,"unit":"°C"})

    async def test_unknown_units_are_not_presented_as_valid_fahrenheit(self):
        response = httpx.Response(200,json={"current":{"apparent_temperature":-38}},request=httpx.Request("GET","https://example.test"))
        client = MagicMock(); client.get = AsyncMock(return_value=response)
        row = (await conditions.fetch_layer(client,"weather",{},1))[0]
        self.assertNotIn("apparent_temperature",row)
        self.assertNotIn("valid_at",row)
        self.assertEqual(row["source_values"]["apparent_temperature"]["value"],-38)
        self.assertIn("could not be verified",row["data_quality_notes"][0])

    async def test_area_keeps_distinct_model_valid_times(self):
        air_time, weather_time = "2026-10-11T12:00:00+00:00", "2026-10-11T12:15:00+00:00"
        async def layer(client,source,params,count):
            return [{"us_aqi":52,"valid_at":{"air":air_time}} if source == "air" else
                    {"apparent_temperature":-38,"precipitation_probability":0,"valid_at":{"weather":weather_time}} for _ in range(count)]
        conditions.CACHE.pop("area",None)
        with patch("apps.api.conditions.fetch_layer",side_effect=layer):
            result = await conditions.area()
        conditions.CACHE.pop("area",None)
        cell = result["cells"][0]
        self.assertEqual(cell["valid_at"],{"air":air_time,"weather":weather_time})
        self.assertEqual(cell["apparent_temperature"],-38)
        self.assertTrue(cell["data_quality_notes"])
        self.assertNotEqual(result["generated_at"],weather_time)

    async def test_failed_grid_feed_remains_unavailable_without_values(self):
        conditions.CACHE.pop("grid",None)
        with patch("apps.api.conditions.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value.get = AsyncMock(side_effect=httpx.ReadTimeout("offline"))
            grid = await conditions.grid_status()
        self.assertEqual(grid["status"],"unavailable")
        for key in ["severity","reserves_mw","updated","eea_level"]:
            self.assertIsNone(grid[key])

    def test_threshold_explanation_uses_activity_peak_and_saved_limits(self):
        profile = prefs(); data = forecast()
        profile.thresholds = {"feels_like_f":95,"us_aqi":105}
        card = build_recommendations(profile,[data],[],NOW)[0]
        checks = {check["metric"]:check for check in card["threshold_checks"]}
        self.assertEqual(checks["apparent_temperature"]["value"],99)
        self.assertEqual(checks["apparent_temperature"]["threshold"],95)
        self.assertEqual(checks["us_aqi"]["value"],110)
        self.assertEqual(checks["us_aqi"]["threshold"],105)
        self.assertTrue(all(check["exceeded"] for check in checks.values()))

    def test_stale_or_suspect_evidence_does_not_get_trustworthy_threshold_summary(self):
        data = forecast(); data["hours"][0]["apparent_temperature"] = -38
        card = build_recommendations(prefs(),[data],[],NOW)[0]
        self.assertEqual(card["threshold_checks"],[])
        self.assertEqual(card["status"],"data quality review")
        data["hours"][0]["apparent_temperature"] = 85
        data["retrieved_at"] = datetime(2026,10,10,10,tzinfo=timezone.utc).isoformat()
        self.assertEqual(build_recommendations(prefs(),[data],[],NOW)[0]["threshold_checks"],[])

    def test_negative_modeled_aqi_is_retained_with_review_status(self):
        data = forecast(); data["hours"][0]["us_aqi"] = -10
        card = build_recommendations(prefs(),[data],[],NOW)[0]
        self.assertEqual(card["original_conditions"]["us_aqi"],-10)
        self.assertEqual(card["status"],"data quality review")
        self.assertEqual(card["threshold_checks"],[])
