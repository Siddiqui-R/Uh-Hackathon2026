"""Area-wide map layers (modeled air/heat lattice, ERCOT grid status) and advice for any point."""
import asyncio
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any
import httpx
from .environment import distance, forecast, hazards
from .forecast_quality import temperature_f, quality_notes
from .models import Location, UserPrefs
from .recommendations import build_recommendations, hour_for

UTC = timezone.utc
BOUNDS = {"south":29.45,"north":30.15,"west":-95.85,"east":-94.95}  # greater Houston
LIMITS = {"south":29.0,"north":30.7,"west":-96.4,"east":-94.4}  # accepted map-pin area
STEPS = 7
ERCOT_URL = "https://www.ercot.com/api/1/services/read/dashboards/daily-prc.json"
LAYERS: dict[str, tuple[str, list[str], dict[str, str]]] = {
    "air":("https://air-quality-api.open-meteo.com/v1/air-quality",["us_aqi","pm2_5","ozone"],{}),
    "weather":("https://api.open-meteo.com/v1/forecast",["apparent_temperature","precipitation_probability"],{"temperature_unit":"fahrenheit"})}
GEOCODE_URL = "https://nominatim.openstreetmap.org/search"
CACHE: dict[str, tuple[datetime, dict[str, Any]]] = {}
GEOCODES: dict[str, list[dict[str, Any]]] = {}
GEOCODE_LOCK = asyncio.Lock()
GEOCODE_LAST = [0.0]

def lattice() -> list[tuple[float, float]]:
    dlat,dlon = (BOUNDS["north"]-BOUNDS["south"])/STEPS,(BOUNDS["east"]-BOUNDS["west"])/STEPS
    return [(round(BOUNDS["south"]+dlat*(i+.5),4),round(BOUNDS["west"]+dlon*(j+.5),4)) for i in range(STEPS) for j in range(STEPS)]

def cached(key: str, ttl: timedelta, now: datetime) -> dict[str, Any] | None:
    hit = CACHE.get(key)
    return hit[1] if hit and now-hit[0] < ttl else None

async def fetch_layer(client: httpx.AsyncClient, source: str, params: dict[str, str], count: int) -> list[dict[str, Any]]:
    url,names,extra = LAYERS[source]
    for attempt in range(2):  # Open-Meteo occasionally times out or rate-limits a burst; one retry covers it.
        try:
            response = await client.get(url,params={**params,"current":",".join(names),**extra})
            response.raise_for_status()
            payload = response.json()
            rows = payload if isinstance(payload,list) else [payload]
            if len(rows) != count:
                raise ValueError("Lattice size mismatch")
            values = []
            for row in rows:
                current, units = row["current"], row.get("current_units", {})
                entry: dict[str, Any] = {}
                timestamp = current.get("time")
                if timestamp:
                    stamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    stamp = stamp.replace(tzinfo=UTC) if stamp.tzinfo is None else stamp.astimezone(UTC)
                    entry["valid_at"] = {source: stamp.isoformat()}
                for name in names:
                    value = current.get(name)
                    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                        continue
                    if name == "apparent_temperature":
                        normalized = temperature_f(value, units.get(name))
                        entry["source_values"] = {name:{"value":value,"unit":units.get(name)}}
                        if normalized is None:
                            entry["data_quality_notes"] = [f"Open-Meteo feels-like raw value {value:g}; unit {units.get(name) or 'not supplied'}. Fahrenheit could not be verified."]
                            continue
                        entry[name] = normalized
                    else:
                        entry[name] = float(value)
                values.append(entry)
            return values
        except Exception:
            if attempt:
                raise
            await asyncio.sleep(1)
    raise AssertionError("unreachable")

async def area() -> dict[str, Any]:
    now = datetime.now(UTC)
    if (hit := cached("area",timedelta(minutes=15),now)) is not None:
        return hit
    points = lattice()
    params = {"latitude":",".join(str(lat) for lat,_ in points),"longitude":",".join(str(lon) for _,lon in points),"timezone":"UTC"}
    async with httpx.AsyncClient(timeout=30) as client:
        responses = await asyncio.gather(*(fetch_layer(client,source,params,len(points)) for source in LAYERS),return_exceptions=True)
    cells: list[dict[str, Any]] = [{"lat":lat,"lon":lon} for lat,lon in points]
    statuses: dict[str, str] = {}
    for source,result in zip(LAYERS,responses):
        if isinstance(result,BaseException):
            statuses[source] = "unavailable"
            continue
        for cell,values in zip(cells,result):
            cell.setdefault("valid_at", {}).update(values.pop("valid_at", {}))
            cell.update(values)
        statuses[source] = "live model"
    for cell in cells:
        cell["data_quality_notes"] = quality_notes(cell,cell["lat"],cell["lon"])
    result = {"generated_at":now.isoformat(),"bounds":BOUNDS,
      "cell":{"dlat":(BOUNDS["north"]-BOUNDS["south"])/STEPS,"dlon":(BOUNDS["east"]-BOUNDS["west"])/STEPS},
      "cells":cells,"source_status":statuses,
      "attribution":"Modeled current conditions on a ~11 km grid: CAMS / Open-Meteo air quality and Open-Meteo weather. Not street-level sensor readings."}
    if all(status == "live model" for status in statuses.values()):
        CACHE["area"] = (now,result)
    elif "live model" in statuses.values():
        # Keep a partial result briefly so a failed layer is retried soon instead of hiding for 15 minutes.
        CACHE["area"] = (now-timedelta(minutes=13),result)
    return result

def grid_severity(state: str, eea: int) -> str:
    if eea > 0 or state in {"emergency","eea"}:
        return "warning"
    return "normal" if state == "normal" else "watch"

async def grid_status() -> dict[str, Any]:
    now = datetime.now(UTC)
    if (hit := cached("grid",timedelta(minutes=5),now)) is not None:
        return hit
    try:
        async with httpx.AsyncClient(timeout=20,headers={"User-Agent":"noach.select/0.2"}) as client:
            response = await client.get(ERCOT_URL)
            response.raise_for_status()
            payload = response.json()
        current = payload["current_condition"]
        eea,state = int(current.get("eea_level") or 0),str(current.get("state","")).lower()
        result = {"status":"live","severity":grid_severity(state,eea),"title":str(current.get("title") or state.title()),
          "note":str(current.get("condition_note") or ""),"eea_level":eea,"reserves_mw":current.get("prc_value"),
          "updated":datetime.strptime(payload["lastUpdated"],"%Y-%m-%d %H:%M:%S%z").astimezone(UTC).isoformat(),
          "scope":"ERCOT statewide grid (includes Houston). Not an outage report for a specific street.",
          "source_url":"https://www.ercot.com/gridmktinfo/dashboards"}
        CACHE["grid"] = (now,result)
        return result
    except Exception:
        return {"status":"unavailable","severity":None,"title":"Grid status unavailable","note":"ERCOT conditions could not be retrieved.",
          "eea_level":None,"reserves_mw":None,"updated":None,"scope":"ERCOT statewide grid","source_url":"https://www.ercot.com/gridmktinfo/dashboards"}

def in_limits(lat: float, lon: float) -> bool:
    return LIMITS["south"] <= lat <= LIMITS["north"] and LIMITS["west"] <= lon <= LIMITS["east"]

async def point(prefs: UserPrefs, lat: float, lon: float) -> dict[str, Any]:
    # ~100 m rounding keeps pins coarse and lets nearby clicks share the forecast cache.
    lat,lon = round(lat,3),round(lon,3)
    pin = Location(id="pin",name=f"Map pin {lat:.3f}, {lon:.3f}",kind="other",lat=lat,lon=lon)
    # Re-home every saved routine to the pin so advice answers "what if I did this here?"
    scoped = prefs.model_copy(update={"locations":[pin],"routines":[r.model_copy(update={"location_id":"pin"}) for r in prefs.routines]})
    snapshot,(flood,mode),grid = await asyncio.gather(forecast(pin),hazards(),grid_status())
    now = datetime.now(UTC)
    gauges = sorted((r for r in flood if "gage height" in r["metric"].lower()),key=lambda r:distance(pin,r))[:3]
    return {"generated_at":now.isoformat(),"timezone":prefs.timezone,"location":pin.model_dump(),
      "forecast_retrieved_at":snapshot["retrieved_at"],"forecast_attribution":snapshot.get("attribution"),
      "current":hour_for(snapshot["hours"],now.replace(minute=0,second=0,microsecond=0)) or {},
      "nearby_gauges":[{**g,"distance_km":round(distance(pin,g),1)} for g in gauges],"grid":grid,
      "recommendations":build_recommendations(scoped,[snapshot],flood,now,grid),
      "source_status":{**snapshot["source_status"],"flood":mode,"grid":grid["status"]},
      "coverage":"Advice uses modeled conditions for this point, the nearest monitored gauges, and statewide grid status. Road closures and outages are not assessed."}

async def geocode(query: str) -> list[dict[str, Any]]:
    """Address search bounded to greater Houston; cached and throttled per the Nominatim usage policy."""
    key = " ".join(query.lower().split())
    if key in GEOCODES:
        return GEOCODES[key]
    async with GEOCODE_LOCK:
        await asyncio.sleep(max(0.0,1.0-(time.monotonic()-GEOCODE_LAST[0])))
        try:
            async with httpx.AsyncClient(timeout=15,headers={"User-Agent":"noach.select/0.2 (Houston environmental assistant)"}) as client:
                response = await client.get(GEOCODE_URL,params={"q":query,"format":"jsonv2","limit":5,"countrycodes":"us","bounded":1,
                    "viewbox":f"{LIMITS['west']},{LIMITS['north']},{LIMITS['east']},{LIMITS['south']}"})
            response.raise_for_status()
            rows = response.json()
        finally:
            GEOCODE_LAST[0] = time.monotonic()
    results = [{"name":row.get("name") or row["display_name"].split(",")[0],"address":row["display_name"],"lat":float(row["lat"]),"lon":float(row["lon"])}
               for row in rows if in_limits(float(row["lat"]),float(row["lon"]))]
    if len(GEOCODES) > 500:
        GEOCODES.clear()
    GEOCODES[key] = results
    return results
