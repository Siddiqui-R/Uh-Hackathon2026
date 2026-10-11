"""Regression checks for the detection decisions and simulated baseline."""
import unittest
import asyncio
import os
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from datetime import datetime, timedelta, timezone

from apps.api.anomaly_detection import Finding, detect_pm25, detect_rising_water
from apps.api.ingest.air import parse_readings, poll_air
from apps.api.main import app
from apps.api.store import DEMO_ALERTS, DEMO_ALERT_KEYS, DEMO_PREFS, alerts_after
from apps.api.anomaly_store import DEMO_ANOMALIES, anomalies_after, publish_anomaly
from apps.api.models import UserPrefs, Location, Routine
from fastapi.testclient import TestClient


NOW = datetime(2026, 10, 10, 21, 30, tzinfo=timezone.utc)


def history(values: list[float], end: datetime = NOW) -> list[tuple[datetime, float]]:
    return [(end - timedelta(hours=len(values)-index), value) for index, value in enumerate(values)]


class AnomalyDetectionTests(unittest.TestCase):
    def test_rising_water_requires_fresh_sustained_evidence(self) -> None:
        prior = [(NOW - timedelta(minutes=minutes), level) for minutes, level in
                 [(60, 7.0), (45, 7.2), (30, 7.4), (15, 7.7)]]
        finding = detect_rising_water(8.1, NOW, prior, NOW)
        self.assertIsNotNone(finding)
        assert finding is not None
        self.assertEqual(finding.severity, "watch")
        self.assertEqual(finding.sample_count, 4)
        self.assertAlmostEqual(finding.baseline, 7.0)
        self.assertAlmostEqual(finding.score, 1.1)
        self.assertEqual(detect_rising_water(8.7, NOW, prior, NOW).severity, "warning")
        self.assertIsNone(detect_rising_water(7.4, NOW, prior, NOW))
        self.assertIsNone(detect_rising_water(8.1, NOW-timedelta(hours=2), prior, NOW))
        self.assertIsNone(detect_rising_water(8.1, NOW, prior[:2], NOW))
        self.assertIsNone(detect_rising_water(8.1, NOW, [(stamp-timedelta(hours=3), level) for stamp,level in prior], NOW))

    def test_spike_has_station_baseline_evidence(self) -> None:
        finding = detect_pm25(52, NOW, history([10, 11, 12, 11, 13, 12, 10, 12]), NOW)
        self.assertIsNotNone(finding)
        assert finding is not None
        self.assertEqual(finding.sample_count, 8)
        self.assertEqual(finding.severity, "warning")
        self.assertAlmostEqual(finding.baseline, 11.375)

    def test_normal_and_small_changes_are_ignored(self) -> None:
        baseline = history([10, 11, 12, 11, 13, 12, 10, 12])
        self.assertIsNone(detect_pm25(12, NOW, baseline, NOW))
        self.assertIsNone(detect_pm25(20, NOW, baseline, NOW))

    def test_missing_and_stale_evidence_is_ignored(self) -> None:
        self.assertIsNone(detect_pm25(52, NOW, history([10, 11, 12]), NOW))
        self.assertIsNone(detect_pm25(52, NOW-timedelta(hours=4), history([10]*8, NOW-timedelta(hours=4)), NOW))
        self.assertIsNone(detect_pm25(52, NOW, history([10]*8, NOW-timedelta(hours=5)), NOW))
        old_valid = history([10]*8, NOW-timedelta(hours=5))
        self.assertIsNone(detect_pm25(52, NOW, old_valid + [(NOW-timedelta(hours=1), -2)], NOW))

    def test_airnow_parser_accepts_only_houston_pm25_concentrations(self) -> None:
        valid = {"Parameter":"PM2.5", "Unit":"UG/M3", "AQSID":"482010001", "SiteName":"Houston test monitor",
                 "Latitude":29.72, "Longitude":-95.34, "UTC":"2026-10-10T20:00", "Value":12.5}
        rows = parse_readings([valid, {**valid,"Parameter":"OZONE"}, {**valid,"Value":-3},
                               {**valid,"Latitude":35.0}])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0].value,12.5)
        self.assertEqual(rows[0].observed_at.tzinfo,timezone.utc)

    def test_airnow_parser_accepts_monitoring_site_code_fields(self) -> None:
        row = {"Parameter":"PM2.5", "Unit":"UG/M3", "FullAQSCode":"482010001",
               "IntlAQSCode":"840482010001", "SiteName":"Houston test monitor",
               "Latitude":29.72, "Longitude":-95.34, "UTC":"2026-10-10T20:00", "Value":12.5}
        reading = parse_readings([row])[0]
        self.assertEqual(reading.station_id, "airnow:482010001")
        self.assertEqual(reading.station_name, "Houston test monitor")
        self.assertEqual(reading.observed_at, datetime(2026, 10, 10, 20, tzinfo=timezone.utc))

    def test_demo_endpoint_is_guarded_and_uses_detector(self) -> None:
        with patch.dict("os.environ", {"DATABASE_URL":"mock", "NOACH_DEMO_MODE":"false", "NOACH_ALLOW_SIMULATION":"false", "INTERNAL_API_TOKEN":""}):
            with TestClient(app) as client:
                self.assertEqual(client.post("/api/demo/simulate-anomaly").status_code,404)
        with patch.dict("os.environ", {"DATABASE_URL":"mock", "NOACH_DEMO_MODE":"true", "INTERNAL_API_TOKEN":""}), \
             patch("apps.api.main.publish_anomaly",new=AsyncMock(return_value={"is_simulated":True,"value":52})) as publish:
            with TestClient(app) as client:
                response = client.post("/api/demo/simulate-anomaly")
                self.assertEqual(response.status_code,200)
                self.assertTrue(response.json()["event"]["is_simulated"])
                self.assertEqual(publish.await_args.kwargs["simulated"],True)
                self.assertEqual(publish.await_args.args[6].sample_count,8)

    def test_temporary_rehearsal_connects_saved_place_anomaly_and_alert(self) -> None:
        profile = UserPrefs(user_id="local-demo", locations=[Location(id="uh", name="UH", kind="school", lat=29.7199, lon=-95.3422)],
                            routines=[Routine(id="ball", activity="Basketball", location_id="uh", local_time="17:00")])
        with patch.dict("os.environ", {"NOACH_DEMO_MODE":"true", "NOACH_DEMO_STORAGE":"memory", "NOACH_ENV":"development", "INTERNAL_API_TOKEN":""}):
            DEMO_PREFS.clear(); DEMO_ALERTS.clear(); DEMO_ALERT_KEYS.clear(); DEMO_ANOMALIES.clear()
            try:
                with TestClient(app) as client:
                    saved = client.post("/api/prefs", json=profile.model_dump(mode="json"))
                    self.assertEqual(saved.status_code, 200)
                    self.assertEqual(saved.json()["storage"], "temporary memory")
                    event = client.post("/api/demo/simulate-anomaly")
                    self.assertEqual(event.status_code, 200)
                    self.assertTrue(event.json()["event"]["is_simulated"])
                    self.assertEqual(client.get("/api/anomalies").json()[0]["id"], event.json()["event"]["id"])
                    flood_event = client.post("/api/demo/simulate-anomaly", json={"kind":"flood"})
                    self.assertEqual(flood_event.status_code, 200)
                    self.assertEqual(flood_event.json()["event"]["hazard"], "flood")
                    self.assertEqual(client.post("/api/demo/simulate-anomaly", json={"kind":"grid"}).status_code, 422)
                    marked = client.post("/api/alerts/read", json={"user_id":"local-demo","alert_id":1,"read":True})
                    self.assertEqual(marked.status_code, 200)
                    self.assertIsNotNone(marked.json()["read_at"])
                    self.assertIsNotNone(asyncio.run(alerts_after("local-demo", 0))[0]["read_at"])
                    self.assertEqual(client.post("/api/alerts/read", json={"user_id":"other-user","alert_id":1,"read":True}).status_code, 404)
                    self.assertEqual(client.post("/api/alerts/read", json={"user_id":"local-demo","alert_id":1,"read":False}).json()["read_at"], None)
                    self.assertEqual(client.get("/api/status").json()["database"], "temporary memory")
                alerts = asyncio.run(alerts_after("local-demo", 0))
                self.assertEqual(len(alerts), 2)
                self.assertTrue(all(alert["demo"] for alert in alerts))
                self.assertIn("UH", alerts[0]["message"])
                self.assertEqual(len(asyncio.run(anomalies_after(0))), 2)
            finally:
                DEMO_PREFS.clear(); DEMO_ALERTS.clear(); DEMO_ALERT_KEYS.clear(); DEMO_ANOMALIES.clear()

    def test_flood_anomaly_alert_is_labeled_as_unverified_station_trend(self) -> None:
        profile = UserPrefs(user_id="water-demo", locations=[Location(id="bayou", name="Bayou", lat=29.7752, lon=-95.3972)])
        with patch.dict("os.environ", {"NOACH_DEMO_MODE":"true", "NOACH_DEMO_STORAGE":"memory", "NOACH_ENV":"development"}):
            DEMO_PREFS.clear(); DEMO_ALERTS.clear(); DEMO_ALERT_KEYS.clear(); DEMO_ANOMALIES.clear()
            try:
                DEMO_PREFS[profile.user_id] = profile
                finding = Finding(baseline=7.0, sample_count=4, score=1.1,
                                  method="observed gage-height rise (ft/hour)", severity="watch")
                event = asyncio.run(publish_anomaly("08074500", "Whiteoak Bayou", 29.7752, -95.3972,
                    NOW, 8.1, finding, "USGS", simulated=True, hazard="flood", metric="Gage height, feet", unit="ft"))
                self.assertEqual(event["hazard"], "flood")
                alerts = asyncio.run(alerts_after(profile.user_id, 0))
                self.assertEqual(len(alerts), 1)
                self.assertEqual(alerts[0]["hazard"], "flood")
                self.assertIn("not an official flood warning", alerts[0]["message"])
            finally:
                DEMO_PREFS.clear(); DEMO_ALERTS.clear(); DEMO_ALERT_KEYS.clear(); DEMO_ANOMALIES.clear()

    def test_browser_simulation_alerts_only_requesting_profile(self) -> None:
        place = Location(id="uh", name="UH", kind="school", lat=29.7199, lon=-95.3422)
        finding = Finding(baseline=11.0, sample_count=8, score=4.0, method="PM2.5", severity="watch")
        with patch.dict("os.environ", {"NOACH_DEMO_MODE":"true", "NOACH_DEMO_STORAGE":"memory", "NOACH_ENV":"development"}):
            DEMO_PREFS.clear(); DEMO_ALERTS.clear(); DEMO_ALERT_KEYS.clear(); DEMO_ANOMALIES.clear()
            try:
                DEMO_PREFS["alice"] = UserPrefs(user_id="alice", locations=[place])
                DEMO_PREFS["bob"] = UserPrefs(user_id="bob", locations=[place])
                asyncio.run(publish_anomaly("demo:uh", "UH demo monitor", place.lat, place.lon,
                    NOW, 52.0, finding, "Synthetic demonstration", simulated=True, target_user_id="alice"))
                self.assertEqual(len(asyncio.run(alerts_after("alice", 0))), 1)
                self.assertEqual(asyncio.run(alerts_after("bob", 0)), [])
            finally:
                DEMO_PREFS.clear(); DEMO_ALERTS.clear(); DEMO_ALERT_KEYS.clear(); DEMO_ANOMALIES.clear()


class AirIngestionTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_poll_backfills_history_and_publishes_only_fresh_spike(self) -> None:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        values = [10, 11, 12, 11, 13, 12, 10, 12, 52]
        payload = [{"Parameter":"PM2.5", "Unit":"UG/M3", "FullAQSCode":"482010001",
                    "SiteName":"Houston test monitor", "Latitude":29.72, "Longitude":-95.34,
                    "UTC":(now-timedelta(hours=8-index)).strftime("%Y-%m-%dT%H:%M:%S"), "Value":value}
                   for index, value in enumerate(values)]

        class Cursor:
            def __init__(self, one=None, rows=None):
                self.one, self.rows = one, rows or []

            async def fetchone(self):
                return self.one

            async def fetchall(self):
                return self.rows

        class Database:
            def __init__(self):
                self.identities = set()
                self.readings = []
                self.connections = 0

            async def execute(self, sql, params=None):
                if "INSERT INTO reading_identities" in sql:
                    identity = (params[0], params[1])
                    if identity in self.identities:
                        return Cursor()
                    self.identities.add(identity)
                    return Cursor(one={"claimed": 1})
                if "SELECT time,value FROM sensor_readings" in sql:
                    station, start, end = params
                    rows = [{"time": stamp, "value": value} for stamp, site, value in self.readings
                            if site == station and start <= stamp < end]
                    return Cursor(rows=sorted(rows, key=lambda row: row["time"], reverse=True)[:48])
                if "INSERT INTO sensor_readings" in sql:
                    self.readings.append((params[0], params[1], params[2]))
                return Cursor()

        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                return payload

        class Client:
            def __init__(self):
                self.requests = []

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, url, *, params):
                self.requests.append((url, params))
                return Response()

        db, client = Database(), Client()

        @asynccontextmanager
        async def database_connection():
            db.connections += 1
            yield db

        with patch.dict(os.environ, {"AIRNOW_API_KEY": "test-only"}), \
             patch("apps.api.ingest.air.httpx.AsyncClient", return_value=client), \
             patch("apps.api.ingest.air.connection", database_connection), \
             patch("apps.api.ingest.air.publish_anomaly", new=AsyncMock()) as publish:
            self.assertEqual(await poll_air(), 9)
            self.assertEqual(len(db.readings), 9)
            self.assertEqual(db.connections, 1)
            publish.assert_awaited_once()
            self.assertEqual(publish.await_args.args[5], 52)
            self.assertEqual(publish.await_args.args[6].sample_count, 8)
            self.assertEqual(await poll_air(), 0)
            publish.assert_awaited_once()
            self.assertEqual(len(client.requests), 2)
            self.assertEqual(client.requests[0][1]["parameters"], "PM25")


if __name__ == "__main__":
    unittest.main()
