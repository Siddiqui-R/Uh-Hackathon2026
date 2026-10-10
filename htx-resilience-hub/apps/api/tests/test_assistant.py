"""Offline regression tests: no external HTTP or database writes."""
import asyncio
import os
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from pydantic import ValidationError
from apps.api.models import UserPrefs, Location, Routine
from apps.api.environment import severity, fresh, forecast, CACHE, location_key
from apps.api.recommendations import hour_for, next_activity, build_recommendations
from apps.api.workers import alert_candidates
from apps.api.ingest.flood import parse_readings, write_readings, INSERT_SQL
from apps.api.main import app
from apps.api.providers import gemini_answer
from apps.api.store import get_prefs, DEMO_PREFS

UTC = timezone.utc
NOW = datetime(2026,10,10,21,30,tzinfo=UTC)
LOCATION = Location(id="uh",name="UH",kind="school",lat=29.7199,lon=-95.3422)

def prefs(user: str = "alice") -> UserPrefs:
    return UserPrefs(user_id=user,locations=[LOCATION],routines=[Routine(id="ball",activity="Basketball",location_id="uh",local_time="17:00")])

def snapshot() -> dict:
    return {"location":LOCATION.model_dump(),"retrieved_at":NOW.isoformat(),"hours":[
        {"time":datetime(2026,10,10,22,tzinfo=UTC).isoformat(),"apparent_temperature":99,"us_aqi":110},
        {"time":datetime(2026,10,10,23,tzinfo=UTC).isoformat(),"apparent_temperature":85,"us_aqi":40}
    ],"source_status":{"weather":"live model","air":"live model"}}

class EnvironmentalTests(unittest.TestCase):
    def test_severity_boundaries(self) -> None:
        self.assertEqual([severity(v) for v in [9,10,10.01,15,15.01]],["normal","normal","watch","watch","warning"])

    def test_timezones_and_weekdays(self) -> None:
        self.assertEqual(next_activity(prefs().routines[0],prefs(),NOW),datetime(2026,10,10,22,tzinfo=UTC))
        restricted = prefs().model_copy(deep=True)
        restricted.routines[0].weekdays = [0]
        self.assertEqual(next_activity(restricted.routines[0],restricted,NOW).weekday(),0)
        with self.assertRaises(ValidationError):
            Routine(id="a",activity="Exercise",location_id="uh",local_time="25:00")
        with self.assertRaises(ValidationError):
            UserPrefs(user_id="a",timezone="Not/AZone")

    def test_missing_routine_location(self) -> None:
        with self.assertRaises(ValidationError):
            UserPrefs(user_id="a",routines=[Routine(id="a",activity="Exercise",location_id="missing",local_time="17:00")])

    def test_valid_hour_and_alternative(self) -> None:
        data=snapshot()
        self.assertIsNone(hour_for(data["hours"],NOW))
        cards=build_recommendations(prefs(),[data],[],NOW)
        self.assertEqual(cards[0]["status"],"consider alternatives")
        self.assertEqual(cards[0]["alternative_time"],data["hours"][1]["time"])

    def test_stale_missing_and_alert_window(self) -> None:
        self.assertTrue(fresh(NOW,NOW))
        self.assertFalse(fresh(NOW-timedelta(minutes=61),NOW))
        data=snapshot()
        self.assertEqual(len(alert_candidates(prefs(),[data],NOW)),2)
        self.assertEqual(alert_candidates(prefs(),[data],NOW-timedelta(hours=3)),[])
        data["retrieved_at"]=(NOW-timedelta(hours=2)).isoformat()
        self.assertEqual(alert_candidates(prefs(),[data],NOW),[])
        self.assertEqual(build_recommendations(prefs(),[data],[],NOW)[0]["status"],"unavailable")

    def test_dedup_identity_and_user_isolation(self) -> None:
        a=alert_candidates(prefs("alice"),[snapshot()],NOW)
        b=alert_candidates(prefs("bob"),[snapshot()],NOW)
        self.assertEqual(a,alert_candidates(prefs("alice"),[snapshot()],NOW))
        self.assertNotEqual(a[0][0],b[0][0])
        self.assertEqual(a[0][1]["user_id"],"alice")

    def test_parser_and_single_transaction(self) -> None:
        payload={"value":{"timeSeries":[{"sourceInfo":{"siteCode":[{"value":"08074500"}]},
            "variable":{"variableName":"Gage height, feet","unit":{"unitCode":"ft"}},
            "values":[{"value":[{"value":v,"dateTime":"2026-10-10T12:45:00-05:00"} for v in ["7.71","-999999","bad","nan",None]]}]}]}}
        rows=parse_readings(payload)
        self.assertEqual(len(rows),1)
        with patch("apps.api.ingest.flood.psycopg.connect") as connect:
            cursor=connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.rowcount=1
            self.assertEqual(write_readings("mock",rows),1)
            cursor.executemany.assert_called_with(INSERT_SQL,[rows[0][:4]+rows[0]])
            connect.return_value.__exit__.assert_called_once_with(None,None,None)

class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_forecast_cache_keeps_place_names_private(self) -> None:
        alice = LOCATION.model_copy(update={"id":"alice-place","name":"Alice private name"})
        bob = LOCATION.model_copy(update={"id":"bob-place","name":"Bob private name"})
        key = location_key(alice)
        CACHE[key] = (datetime.now(UTC), {"location":alice.model_dump(),"hours":[]})
        try:
            result = await forecast(bob)
            self.assertEqual(result["location"],bob.model_dump())
            self.assertEqual(CACHE[key][1]["location"],alice.model_dump())
        finally:
            CACHE.pop(key,None)

    async def test_missing_gemini_fallback(self) -> None:
        with patch.dict(os.environ,{"GEMINI_API_KEY":"","GEMINI_MODEL":""}):
            answer,provider=await gemini_answer("Question",{"recommendations":[]})
            self.assertEqual(provider,"fallback")
            self.assertIn("rule-based",answer)

    async def test_demo_profiles_not_shared(self) -> None:
        DEMO_PREFS["alice"]=prefs("alice")
        with patch.dict(os.environ,{"NOACH_DEMO_MODE":"true"}), patch("apps.api.store.connection",side_effect=RuntimeError("offline")):
            alice,_=await get_prefs("alice")
            bob,_=await get_prefs("bob")
            self.assertEqual(alice.user_id,"alice")
            self.assertEqual(bob.locations,[])

class RouteTests(unittest.TestCase):
    def test_internal_api_rejects_missing_token(self) -> None:
        with patch.dict(os.environ,{"INTERNAL_API_TOKEN":"test-only","DATABASE_URL":"mock"}):
            with TestClient(app) as client:
                self.assertEqual(client.get("/health").status_code,200)
                self.assertEqual(client.get("/api/status").status_code,401)

    def test_hazard_contract_and_ask(self) -> None:
        row={"hazard":"flood","station_id":"08074500","station_name":"Whiteoak","lat":29.7752,"lon":-95.3972,
             "metric":"Gage height, feet","value":7.71,"unit":"ft","severity":"normal","time":NOW.isoformat()}
        with patch.dict(os.environ,{"INTERNAL_API_TOKEN":"","DATABASE_URL":"mock"}), patch("apps.api.main.hazards",new=AsyncMock(return_value=([row],"live"))), patch("apps.api.main.briefing",new=AsyncMock(return_value={})), patch("apps.api.main.get_prefs",new=AsyncMock(return_value=(prefs(),"database"))), patch("apps.api.main.memory_get",new=AsyncMock(return_value="")), patch("apps.api.main.gemini_answer",new=AsyncMock(return_value=("Grounded answer","gemini"))):
            with TestClient(app) as client:
                response=client.get("/api/hazards")
                self.assertEqual(response.headers["X-Data-Mode"],"live")
                self.assertEqual(set(response.json()[0]),set(row))
                response=client.post("/api/ask",json={"question":"Basketball?","user_id":"alice"})
                self.assertEqual(response.json(),{"answer":"Grounded answer"})
                self.assertEqual(response.headers["X-AI-Provider"],"gemini")

if __name__ == "__main__":
    unittest.main()
