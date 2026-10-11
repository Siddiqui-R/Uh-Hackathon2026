"""Offline regression tests: no external HTTP or database writes."""
import asyncio
import os
import unittest
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from pydantic import ValidationError
from apps.api.models import AskRequest, UserPrefs, Location, Routine
from apps.api.environment import public_hazards, fresh, forecast, CACHE, location_key
from apps.api.recommendations import hour_for, next_activity, build_recommendations
from apps.api.conditions import grid_severity, lattice, point, geocode, GEOCODES, area
from apps.api import conditions
from apps.api.workers import alert_candidates
from apps.api.ingest.flood import parse_readings, write_readings, INSERT_SQL
from apps.api.main import app
from apps.api.providers import gemini_answer
from apps.api.store import get_prefs, conversation_history, DEMO_PREFS

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
    def test_gage_heights_have_no_shared_flood_stage_threshold(self) -> None:
        rows = [{"station_id":"low","time":NOW,"value":7.0},
                {"station_id":"high","time":NOW,"value":16.81}]
        result = public_hazards(rows)
        self.assertEqual([row["severity"] for row in result], ["unrated", "unrated"])
        self.assertEqual(result[0]["time"], NOW.isoformat())

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
        self.assertEqual(cards[0]["original_conditions"]["feels_like_f"],99)
        self.assertEqual(cards[0]["original_conditions"]["us_aqi"],110)
        self.assertEqual(cards[0]["alternative_conditions"]["feels_like_f"],85)
        self.assertEqual(cards[0]["alternative_conditions"]["us_aqi"],40)

    def test_heat_comparison_when_air_forecast_is_missing(self) -> None:
        data=snapshot()
        for hour in data["hours"]:
            hour.pop("us_aqi")
        cards=build_recommendations(prefs(),[data],[],NOW)
        self.assertEqual(cards[0]["status"],"consider alternatives")
        self.assertIsNone(cards[0]["original_conditions"]["us_aqi"])
        self.assertIsNone(cards[0]["alternative_conditions"]["us_aqi"])
        self.assertNotIn("US AQI",cards[0]["reason"])

    def test_no_unsupported_comparison_without_matching_evidence(self) -> None:
        data=snapshot()
        data["hours"][1].pop("us_aqi")
        cards=build_recommendations(prefs(),[data],[],NOW)
        self.assertIsNone(cards[0]["alternative_time"])
        self.assertIsNone(cards[0]["alternative_conditions"])

    def test_alternative_skips_overnight_hour(self) -> None:
        evening=prefs()
        evening.routines[0].local_time="19:00"
        evening_now=datetime(2026,10,10,23,30,tzinfo=UTC)
        data={"location":LOCATION.model_dump(),"retrieved_at":evening_now.isoformat(),"hours":[
            {"time":datetime(2026,10,11,0,tzinfo=UTC).isoformat(),"apparent_temperature":99,"us_aqi":110},
            {"time":datetime(2026,10,11,9,tzinfo=UTC).isoformat(),"apparent_temperature":80,"us_aqi":40},
            {"time":datetime(2026,10,11,12,tzinfo=UTC).isoformat(),"apparent_temperature":83,"us_aqi":42},
        ]}
        cards=build_recommendations(evening,[data],[],evening_now)
        self.assertEqual(cards[0]["alternative_time"],data["hours"][2]["time"])

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

    def test_grid_advice_follows_ercot_state(self) -> None:
        live = {"status":"live","title":"Normal Conditions","note":"Enough power.","reserves_mw":"17,723","updated":NOW.isoformat(),"source_url":"https://www.ercot.com"}
        self.assertEqual([grid_severity(s,e) for s,e in [("normal",0),("conservation",0),("normal",1),("emergency",0)]],["normal","watch","warning","warning"])
        statuses = [build_recommendations(prefs(),[snapshot()],[],NOW,{**live,"severity":sev})[-1]["status"] for sev in ["normal","watch","warning"]]
        self.assertEqual(statuses,["normal conditions","conserve","grid emergency"])
        self.assertEqual(build_recommendations(prefs(),[snapshot()],[],NOW,{"status":"unavailable","severity":None})[-1]["status"],"unavailable")
        self.assertEqual(len(build_recommendations(prefs(),[snapshot()],[],NOW)),1)

    def test_lattice_covers_houston(self) -> None:
        cells = lattice()
        self.assertEqual(len(cells),49)
        self.assertTrue(any(abs(lat-29.76) < .06 and abs(lon+95.37) < .07 for lat,lon in cells))

class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_account_history_query_omits_null_cursor_and_paginates(self) -> None:
        cursor = SimpleNamespace(fetchall=AsyncMock(return_value=[]))
        conn = SimpleNamespace(execute=AsyncMock(return_value=cursor))

        @asynccontextmanager
        async def fake_connection():
            yield conn

        with patch("apps.api.store.connection", fake_connection):
            self.assertEqual(await conversation_history("acct:alice"), [])
            query, params = conn.execute.await_args.args
            self.assertNotIn("IS NULL", query)
            self.assertEqual(params, ["acct:alice", 20])

            self.assertEqual(await conversation_history("acct:alice", before_id=42), [])
            query, params = conn.execute.await_args.args
            self.assertIn("id<%s", query)
            self.assertEqual(params, ["acct:alice", 42, 20])

    async def test_point_rehomes_routines_to_pin(self) -> None:
        grid = {"status":"live","severity":"normal","title":"Normal","note":"","reserves_mw":None,"updated":None,"source_url":"https://www.ercot.com"}
        pinned = {**snapshot(),"retrieved_at":datetime.now(UTC).isoformat()}
        with patch("apps.api.conditions.forecast",new=AsyncMock(return_value=pinned)) as fc, patch("apps.api.conditions.hazards",new=AsyncMock(return_value=([],"live"))), patch("apps.api.conditions.grid_status",new=AsyncMock(return_value=grid)):
            result = await point(prefs(),29.76012,-95.36987)
        self.assertEqual((fc.call_args.args[0].lat,fc.call_args.args[0].lon),(29.76,-95.37))
        self.assertEqual(result["recommendations"][0]["title"],"Basketball")
        self.assertEqual(result["recommendations"][-1]["id"],"grid")

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

    async def test_gemini_receives_structured_context_and_closes_client(self) -> None:
        import json

        class FakeAsyncClient:
            def __init__(self):
                self.models = SimpleNamespace(generate_content=AsyncMock(
                    return_value=SimpleNamespace(text="Use the cooler forecast hour.")))
                self.closed = False

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                self.closed = True

        async_client = FakeAsyncClient()
        with patch.dict(os.environ,{"GEMINI_API_KEY":"test-only","GEMINI_MODEL":"gemini-flash-latest"}), \
             patch("google.genai.Client",return_value=SimpleNamespace(aio=async_client)):
            answer,provider=await gemini_answer(
                "What about tomorrow?",{"source_status":{"air":"live model"}},"Saved UH",
                history=[{"question":"Basketball near UH?","answer":"Check the forecast."}],
            )
        self.assertEqual(provider,"gemini")
        self.assertEqual(answer,"Use the cooler forecast hour.")
        self.assertTrue(async_client.closed)
        request=json.loads(async_client.models.generate_content.await_args.kwargs["contents"])
        self.assertEqual(request["question"],"What about tomorrow?")
        self.assertEqual(request["recent_exchanges"],[{"question":"Basketball near UH?","answer":"Check the forecast."}])
        self.assertEqual(request["context"]["source_status"]["air"],"live model")
        self.assertEqual(request["saved_memory"],"Saved UH")

    async def test_demo_profiles_not_shared(self) -> None:
        DEMO_PREFS["alice"]=prefs("alice")
        with patch.dict(os.environ,{"NOACH_DEMO_MODE":"true"}), patch("apps.api.store.connection",side_effect=RuntimeError("offline")):
            alice,_=await get_prefs("alice")
            bob,_=await get_prefs("bob")
            self.assertEqual(alice.user_id,"alice")
            self.assertEqual(bob.locations,[])

    async def test_geocode_drops_matches_outside_houston_and_caches(self) -> None:
        rows = [{"name":"Rice University","display_name":"Rice University, Houston, TX","lat":"29.7168","lon":"-95.4048"},
                {"name":"","display_name":"Houston, Mississippi","lat":"33.89","lon":"-89.0"}]
        response = MagicMock(); response.json.return_value = rows
        client = MagicMock(); client.get = AsyncMock(return_value=response)
        GEOCODES.clear()
        with patch("apps.api.conditions.httpx.AsyncClient") as factory:
            factory.return_value.__aenter__.return_value = client
            first = await geocode("Rice  University")
            second = await geocode("rice university")
        self.assertEqual(first,[{"name":"Rice University","address":"Rice University, Houston, TX","lat":29.7168,"lon":-95.4048}])
        self.assertEqual(second,first)
        client.get.assert_awaited_once()
        GEOCODES.clear()

    async def test_area_retries_and_does_not_hide_a_failed_layer(self) -> None:
        def ok(names: list[str]) -> MagicMock:
            response = MagicMock(); response.json.return_value = [{"current":{n:50 for n in names}, "current_units":{"apparent_temperature":"°F"}} for _ in range(49)]
            return response
        calls = {"air":0,"weather":0}
        async def get(url: str, params: dict) -> MagicMock:
            source = "air" if "air-quality" in url else "weather"
            calls[source] += 1
            if source == "weather" and calls["weather"] <= 3:
                raise conditions.httpx.ReadTimeout("slow")
            return ok(params["current"].split(","))
        client = MagicMock(); client.get = get
        conditions.CACHE.pop("area",None)
        with patch("apps.api.conditions.httpx.AsyncClient") as factory, patch("apps.api.conditions.asyncio.sleep",new=AsyncMock()):
            factory.return_value.__aenter__.return_value = client
            first = await area()
            self.assertEqual(first["source_status"],{"air":"live model","weather":"unavailable"})
            conditions.CACHE["area"] = (conditions.CACHE["area"][0]-timedelta(minutes=3),first)  # partial result expires quickly
            second = await area()
        self.assertEqual(second["source_status"],{"air":"live model","weather":"live model"})
        self.assertEqual(second["cells"][0]["apparent_temperature"],50.0)
        conditions.CACHE.pop("area",None)

class RouteTests(unittest.TestCase):
    def test_ask_history_is_bounded(self) -> None:
        turns = [{"question":"Earlier question","answer":"Earlier answer"}] * 5
        with self.assertRaises(ValidationError):
            AskRequest(question="Follow-up",history=turns)

    def test_internal_api_rejects_missing_token(self) -> None:
        with patch.dict(os.environ,{"INTERNAL_API_TOKEN":"test-only","DATABASE_URL":"mock"}):
            with TestClient(app) as client:
                self.assertEqual(client.get("/health").status_code,200)
                self.assertEqual(client.get("/api/status").status_code,401)

    def test_hazard_contract_and_ask(self) -> None:
        row={"hazard":"flood","station_id":"08074500","station_name":"Whiteoak","lat":29.7752,"lon":-95.3972,
             "metric":"Gage height, feet","value":7.71,"unit":"ft","severity":"unrated","time":NOW.isoformat()}
        with patch.dict(os.environ,{"INTERNAL_API_TOKEN":"","DATABASE_URL":"mock"}), patch("apps.api.main.hazards",new=AsyncMock(return_value=([row],"live"))), patch("apps.api.main.briefing",new=AsyncMock(return_value={})), patch("apps.api.main.get_prefs",new=AsyncMock(return_value=(prefs(),"database"))), patch("apps.api.main.memory_get",new=AsyncMock(return_value="")), patch("apps.api.main.gemini_answer",new=AsyncMock(return_value=("Grounded answer","gemini"))) as generate:
            with TestClient(app) as client:
                response=client.get("/api/hazards")
                self.assertEqual(response.headers["X-Data-Mode"],"live")
                self.assertEqual(set(response.json()[0]),set(row))
                response=client.post("/api/ask",json={"question":"What about tomorrow?","user_id":"alice","history":[{"question":"Basketball?","answer":"Check the forecast."}]})
                self.assertEqual(response.json(),{"answer":"Grounded answer"})
                self.assertEqual(response.headers["X-AI-Provider"],"gemini")
                self.assertEqual(generate.await_args.kwargs["history"],[{"question":"Basketball?","answer":"Check the forecast."}])

    def test_point_route_rejects_outside_houston(self) -> None:
        with patch.dict(os.environ,{"INTERNAL_API_TOKEN":"","DATABASE_URL":"mock"}):
            with TestClient(app) as client:
                self.assertEqual(client.get("/api/conditions/point",params={"user_id":"a","lat":40.7,"lon":-74.0}).status_code,422)

if __name__ == "__main__":
    unittest.main()
