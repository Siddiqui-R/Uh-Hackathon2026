"""Deterministic source-linked suggestions; models never trigger alerts."""
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo
from .environment import UH, distance, fresh
from .models import UserPrefs, Routine

SOURCES = {"heat":"https://www.weather.gov/safety/heat", "air":"https://www.airnow.gov/aqi/aqi-basics/using-air-quality-index/",
           "flood":"https://www.weather.gov/safety/flood", "grid":"https://www.ercot.com/txans"}

def next_activity(routine: Routine, prefs: UserPrefs, now: datetime) -> datetime:
    local = now.astimezone(ZoneInfo(prefs.timezone))
    hour,minute = map(int,routine.local_time.split(":"))
    for offset in range(8):
        day = local.date()+timedelta(days=offset)
        at = datetime(day.year,day.month,day.day,hour,minute,tzinfo=ZoneInfo(prefs.timezone))
        if day.weekday() in routine.weekdays and at >= local:
            return at.astimezone(timezone.utc)
    raise ValueError("Routine has no upcoming day")

def hour_for(hours: list[dict[str, Any]], at: datetime) -> dict[str, Any] | None:
    for hour in hours:
        start = datetime.fromisoformat(hour["time"])
        if start <= at < start+timedelta(hours=1):
            return hour
    return None

def risks(hour: dict[str, Any], prefs: UserPrefs) -> list[str]:
    result: list[str] = []
    if hour.get("apparent_temperature",-999) >= prefs.thresholds.get("feels_like_f",95):
        result.append("heat")
    if hour.get("us_aqi",-999) > prefs.thresholds.get("us_aqi",100):
        result.append("air")
    return result

def suggestions(category: str) -> list[dict[str,str]]:
    content = {"heat":("Consider an indoor or cooler-hour activity","Check local heat guidance and choose a cooler setting for strenuous exercise."),
      "air":("Check air-quality activity guidance","Consider adjusting outdoor activity based on AQI guidance and your own needs."),
      "flood":("Check official conditions before traveling","A gauge cannot establish road safety. Check official updates and avoid flooded roads."),
      "grid":("Shift flexible electricity use","Follow current ERCOT guidance before changing discretionary electricity use.")}
    title,description = content[category]
    return [{"title":title,"description":description,"source_url":SOURCES[category]}]

def build_recommendations(prefs: UserPrefs, forecasts: list[dict[str,Any]], flood: list[dict[str,Any]], now: datetime) -> list[dict[str,Any]]:
    cards: list[dict[str,Any]] = []
    routines = prefs.routines or [Routine(id="daily",activity="Outdoor plans",location_id=(prefs.locations[0].id if prefs.locations else UH.id),local_time=now.astimezone(ZoneInfo(prefs.timezone)).strftime("%H:%M"))]
    for routine in routines:
        location = next((loc for loc in prefs.locations if loc.id == routine.location_id), UH)
        snapshot = next((f for f in forecasts if f["location"]["id"] == location.id), None)
        at = next_activity(routine,prefs,now) if routine.id != "daily" else now
        hour = hour_for(snapshot["hours"],at) if snapshot else None
        complete = bool(hour and "apparent_temperature" in hour and "us_aqi" in hour and snapshot and fresh(snapshot["retrieved_at"],now))
        categories = risks(hour,prefs) if hour and complete else []
        alternative = None
        if categories and snapshot:
            for candidate in snapshot["hours"]:
                stamp = datetime.fromisoformat(candidate["time"])
                if at < stamp <= at+timedelta(hours=12) and "apparent_temperature" in candidate and "us_aqi" in candidate and not risks(candidate,prefs):
                    alternative = stamp.isoformat()
                    break
        cards.append({"id":routine.id,"title":routine.activity,"location":location.name,"time":at.isoformat(),
          "category":"outdoor","status":"unavailable" if not complete else "consider alternatives" if categories else "review conditions",
          "reason":"Forecast coverage is incomplete or stale. Check official conditions before deciding." if not complete else
             f"Modeled feels-like temperature {hour['apparent_temperature']:.0f}°F; modeled US AQI {hour['us_aqi']:.0f}. " + ("Your selected thresholds are exceeded." if categories else "Your selected thresholds are not exceeded; this is not a safety guarantee."),
          "alternative_time":alternative,"suggestions":[s for c in categories for s in suggestions(c)] or suggestions("air"),"demo":False})
    if flood:
        location = prefs.locations[0] if prefs.locations else UH
        gauges = [r for r in flood if "gage height" in r["metric"].lower()]
        if gauges:
            gauge = min(gauges,key=lambda r:distance(location,r))
            cards.append({"id":"commute","title":"Before your commute","location":location.name,"time":gauge["time"],"category":"commute",
              "status":"review official updates" if fresh(gauge["time"],now) else "stale observation",
              "reason":f"Nearest monitored gauge: {gauge['station_name']} ({distance(location,gauge):.1f} km away), {gauge['value']} {gauge['unit']}. Nearby readings do not determine whether your route is safe; road-closure coverage is not connected.",
              "alternative_time":None,"suggestions":suggestions("flood"),"demo":"demo" in gauge["station_name"].lower()})
    return cards
