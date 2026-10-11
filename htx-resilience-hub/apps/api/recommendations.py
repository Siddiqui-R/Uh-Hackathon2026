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
    if hour.get("apparent_temperature") is not None and hour["apparent_temperature"] >= prefs.thresholds.get("feels_like_f",95):
        result.append("heat")
    if hour.get("us_aqi") is not None and hour["us_aqi"] > prefs.thresholds.get("us_aqi",100):
        result.append("air")
    return result

def suggestions(category: str) -> list[dict[str,str]]:
    content = {"heat":("Consider an indoor or cooler-hour activity","Check local heat guidance and choose a cooler setting for strenuous exercise."),
      "air":("Check air-quality activity guidance","Consider adjusting outdoor activity based on AQI guidance and your own needs."),
      "flood":("Check official conditions before traveling","A gauge cannot establish road safety. Check official updates and avoid flooded roads."),
      "grid":("Shift flexible electricity use","Follow current ERCOT guidance before changing discretionary electricity use.")}
    title,description = content[category]
    return [{"title":title,"description":description,"source_url":SOURCES[category]}]

def conditions(hour: dict[str, Any] | None) -> dict[str, Any] | None:
    """Expose only values actually returned for this forecast hour."""
    if not hour:
        return None
    return {"forecast_hour": hour["time"],
            "temperature_f": hour.get("temperature_2m"),
            "feels_like_f": hour.get("apparent_temperature"),
            "us_aqi": hour.get("us_aqi"),
            "pm25_ug_m3": hour.get("pm2_5"),
            "precipitation_probability": hour.get("precipitation_probability")}

def comparable(candidate: dict[str, Any], categories: list[str]) -> bool:
    """A suggested hour must contain the measurements behind each triggered risk."""
    return all((category != "heat" or candidate.get("apparent_temperature") is not None)
               and (category != "air" or candidate.get("us_aqi") is not None)
               for category in categories)

def grid_card(grid: dict[str,Any], location: str, now: datetime) -> dict[str,Any]:
    card = {"id":"grid","title":"Power grid","location":location,"time":grid.get("updated") or now.isoformat(),"category":"grid",
            "alternative_time":None,"demo":False}
    if grid.get("status") != "live":
        return {**card,"status":"unavailable","reason":"ERCOT grid conditions could not be retrieved. Check ERCOT directly before relying on grid status.",
                "suggestions":[{"title":"View ERCOT grid conditions","description":"Official statewide supply and demand dashboard.","source_url":grid.get("source_url",SOURCES["grid"])}]}
    reserves = f" Operating reserves: {grid['reserves_mw']} MW." if grid.get("reserves_mw") else ""
    if grid["severity"] == "normal":
        return {**card,"status":"normal conditions","reason":f"ERCOT reports {grid['title']}: {grid['note']}{reserves} No need to shift electricity use. This is statewide status, not an outage report.",
                "suggestions":[{"title":"View ERCOT grid conditions","description":"Official statewide supply and demand dashboard.","source_url":grid["source_url"]}]}
    return {**card,"status":"conserve" if grid["severity"] == "watch" else "grid emergency",
            "reason":f"ERCOT reports {grid['title']}: {grid['note']}{reserves} Consider delaying laundry, dishwashers and EV charging, and pre-cool your home earlier in the day."
              + (" Charge phones and keep medical devices ready in case of rotating outages." if grid["severity"] == "warning" else ""),
            "suggestions":suggestions("grid")}

def build_recommendations(prefs: UserPrefs, forecasts: list[dict[str,Any]], flood: list[dict[str,Any]], now: datetime, grid: dict[str,Any] | None = None) -> list[dict[str,Any]]:
    cards: list[dict[str,Any]] = []
    routines = prefs.routines or [Routine(id="daily",activity="Outdoor plans",location_id=(prefs.locations[0].id if prefs.locations else UH.id),local_time=now.astimezone(ZoneInfo(prefs.timezone)).strftime("%H:%M"))]
    for routine in routines:
        location = next((loc for loc in prefs.locations if loc.id == routine.location_id), UH)
        snapshot = next((f for f in forecasts if f["location"]["id"] == location.id), None)
        at = next_activity(routine,prefs,now) if routine.id != "daily" else now
        hour = hour_for(snapshot["hours"],at) if snapshot else None
        has_evidence = bool(hour and (hour.get("apparent_temperature") is not None or hour.get("us_aqi") is not None))
        complete = bool(snapshot and fresh(snapshot["retrieved_at"],now) and has_evidence)
        categories = risks(hour,prefs) if hour and complete else []
        alternative = None
        alternative_hour = None
        if categories and snapshot:
            for candidate in snapshot["hours"]:
                stamp = datetime.fromisoformat(candidate["time"])
                local_hour = stamp.astimezone(ZoneInfo(prefs.timezone)).hour
                if at < stamp <= at+timedelta(hours=12) and 6 <= local_hour < 21 and comparable(candidate,categories) and not risks(candidate,prefs):
                    alternative = stamp.isoformat()
                    alternative_hour = candidate
                    break
        if complete and hour:
            values = []
            if hour.get("apparent_temperature") is not None:
                values.append(f"Modeled feels-like temperature {hour['apparent_temperature']:.0f}°F")
            if hour.get("us_aqi") is not None:
                values.append(f"modeled US AQI {hour['us_aqi']:.0f}")
            reason = "; ".join(values) + ". " + ("Your selected thresholds are exceeded." if categories else "Your selected thresholds are not exceeded; this is not a safety guarantee.")
        else:
            reason = "Forecast coverage is incomplete or stale. Check official conditions before deciding."
        cards.append({"id":routine.id,"title":routine.activity,"location":location.name,"time":at.isoformat(),
          "category":"outdoor","status":"unavailable" if not complete else "consider alternatives" if categories else "review conditions",
          "reason":reason,"alternative_time":alternative,
          "original_conditions":conditions(hour) if complete else None,
          "alternative_conditions":conditions(alternative_hour),
          "forecast_retrieved_at":snapshot["retrieved_at"] if snapshot and complete else None,
          "forecast_attribution":snapshot.get("attribution") if snapshot and complete else None,
          "suggestions":[s for c in categories for s in suggestions(c)] or suggestions("air"),"demo":False})
    if flood:
        location = prefs.locations[0] if prefs.locations else UH
        gauges = [r for r in flood if "gage height" in r["metric"].lower()]
        if gauges:
            gauge = min(gauges,key=lambda r:distance(location,r))
            cards.append({"id":"commute","title":"Before your commute","location":location.name,"time":gauge["time"],"category":"commute",
              "status":"review official updates" if fresh(gauge["time"],now) else "stale observation",
              "reason":f"Nearest monitored gauge: {gauge['station_name']} ({distance(location,gauge):.1f} km away), {gauge['value']} {gauge['unit']}. Nearby readings do not determine whether your route is safe; road-closure coverage is not connected.",
              "alternative_time":None,"suggestions":suggestions("flood"),"demo":"demo" in gauge["station_name"].lower()})
    if grid is not None:
        cards.append(grid_card(grid,(prefs.locations[0] if prefs.locations else UH).name,now))
    return cards
