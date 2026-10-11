"""Normalize declared provider units, retaining raw evidence for diagnosis."""
import math
from typing import Any

TEMPERATURES = {"temperature_2m", "apparent_temperature"}

def temperature_f(value: Any, unit: str | None) -> float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return None
    if unit in {"°F", "F", "fahrenheit"}:
        return float(value)
    if unit in {"°C", "C", "celsius"}:
        return float(value) * 9 / 5 + 32
    return None

def quality_notes(hour: dict[str, Any], lat: float, lon: float) -> list[str]:
    notes = list(hour.get("data_quality_notes", []))
    chance = hour.get("precipitation_probability")
    if chance is not None and not 0 <= chance <= 100:
        notes.append(f"Open-Meteo reports rain chance {chance:g}%, outside the expected 0 to 100% range. The value is unchanged; verify the source before planning.")
    for metric, label, unit in [("us_aqi", "modeled US AQI", "US AQI"), ("pm2_5", "modeled PM2.5", "µg/m³")]:
        value = hour.get(metric)
        if value is not None and value < 0:
            notes.append(f"CAMS / Open-Meteo reports {label} {value:g} {unit}, below the expected nonnegative range. The value is unchanged; verify the source before planning.")
    # Broad review bounds for greater Houston, not safety limits or corrections.
    if 29 <= lat <= 30.7 and -96.4 <= lon <= -94.4:
        for metric, label, low, high in [("temperature_2m", "temperature", -10, 125),
                                        ("apparent_temperature", "feels-like temperature", -20, 160)]:
            value = hour.get(metric)
            if value is not None and not low <= value <= high:
                raw = hour.get("source_values", {}).get(metric)
                source_detail = f" (provider value {raw['value']:g}{raw.get('unit') or ' unit unavailable'})" if raw else ""
                notes.append(f"Open-Meteo {label} is {value:g}°F{source_detail}, outside Noach's broad Houston review range ({low} to {high}°F). No correction is applied beyond declared unit conversion; verify the source before planning.")
    return list(dict.fromkeys(notes))
