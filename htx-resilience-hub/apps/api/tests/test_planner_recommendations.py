"""Activity-window regression checks using only modeled forecast fixtures."""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from apps.api.models import Location, UserPrefs
from apps.api.recommendations import build_recommendations, next_activity
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
