"""Deterministic source-linked suggestions; models never trigger alerts."""
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo
from .environment import UH, distance, fresh
from .models import UserPrefs, Routine

SOURCES = {"heat":"https://www.weather.gov/safety/heat", "air":"https://www.airnow.gov/aqi/aqi-basics/using-air-quality-index/",
           "flood":"https://www.weather.gov/safety/flood", "grid":"https://www.ercot.com/txans"}

def next_activity(routine: Routine, prefs: UserPrefs, now: datetime) -> datetime:
    local = now.astimezone(ZoneInfo(prefs.timezone))
    start_date = getattr(routine, "start_date", None)
    if isinstance(start_date, str):
        start_date = date.fromisoformat(start_date)
    hour,minute = map(int,routine.local_time.split(":"))
    if getattr(routine, "recurrence", "weekly") == "none":
        if not start_date:
            raise ValueError("One-time activity has no upcoming time")
        at = datetime(start_date.year,start_date.month,start_date.day,hour,minute,tzinfo=ZoneInfo(prefs.timezone))
        if at < local:
            raise ValueError("One-time activity has no upcoming time")
        return at.astimezone(timezone.utc)
    for offset in range(8):
        day = local.date()+timedelta(days=offset)
        at = datetime(day.year,day.month,day.day,hour,minute,tzinfo=ZoneInfo(prefs.timezone))
        if day.weekday() in routine.weekdays and at >= local and (not start_date or day >= start_date):
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

def hours_for_duration(hours: list[dict[str, Any]], at: datetime, minutes: int) -> list[dict[str, Any]] | None:
    """Require forecast coverage for every hour touched by an activity."""
    end = at + timedelta(minutes=minutes)
    cursor = at
    result: list[dict[str, Any]] = []
    while cursor < end:
        hour = hour_for(hours, cursor)
        if hour is None:
            return None
        if not result or result[-1] is not hour:
            result.append(hour)
        cursor = datetime.fromisoformat(hour["time"]) + timedelta(hours=1)
    return result

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
        try:
            at = next_activity(routine,prefs,now) if routine.id != "daily" else now
        except ValueError:
            continue
        hour = hour_for(snapshot["hours"],at) if snapshot else None
        duration = getattr(routine, "duration_minutes", None)
        period = hours_for_duration(snapshot["hours"], at, duration) if snapshot and duration else ([hour] if hour else None)
        has_evidence = bool(period and all(h.get("apparent_temperature") is not None or h.get("us_aqi") is not None for h in period))
        complete = bool(snapshot and fresh(snapshot["retrieved_at"],now) and has_evidence)
        categories = sorted({category for h in period or [] for category in risks(h,prefs)}) if complete else []
        alternative = None
        alternative_hour = None
        if categories and snapshot:
            for candidate in snapshot["hours"]:
                stamp = datetime.fromisoformat(candidate["time"])
                local_hour = stamp.astimezone(ZoneInfo(prefs.timezone)).hour
                candidate_period = hours_for_duration(snapshot["hours"], stamp, duration) if duration else [candidate]
                if (at < stamp <= at+timedelta(hours=12) and 6 <= local_hour < 21
                    and candidate_period and all(comparable(h,categories) and not risks(h,prefs)
                                                 and (h.get("precipitation_probability") is None or h["precipitation_probability"] <= 50)
                                                 for h in candidate_period)):
                    alternative = stamp.isoformat()
                    alternative_hour = candidate
                    break
        if complete and hour:
            values = []
            feels = [h["apparent_temperature"] for h in period or [] if h.get("apparent_temperature") is not None]
            aqi = [h["us_aqi"] for h in period or [] if h.get("us_aqi") is not None]
            if feels:
                values.append(f"highest modeled feels-like temperature {max(feels):.0f}°F")
            if aqi:
                values.append(f"highest modeled US AQI {max(aqi):.0f}")
            prefix = f"Across the {duration}-minute activity, " if duration else "At the planned time, "
            reason = prefix + "; ".join(values) + ". " + ("Your selected thresholds are exceeded." if categories else "Your selected thresholds are not exceeded; this is not a safety guarantee.")
        else:
            reason = "Forecast coverage is incomplete or stale. Check official conditions before deciding."
        cards.append({"id":routine.id,"title":routine.activity,"location":location.name,"time":at.isoformat(),
          "category":"outdoor","status":"unavailable" if not complete else "consider alternatives" if categories else "review conditions",
          "reason":reason,"alternative_time":alternative,
          "original_conditions":conditions(hour) if complete else None,
          "alternative_conditions":conditions(alternative_hour),
          "forecast_retrieved_at":snapshot["retrieved_at"] if snapshot else None,
          "forecast_attribution":snapshot.get("attribution") if snapshot else None,
          "duration_minutes":duration,
          "forecast_status":"missing" if not snapshot else "stale" if not fresh(snapshot["retrieved_at"],now) else "incomplete" if not has_evidence else "current",
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
