"""Public contracts for noach.select."""
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, Field, model_validator, field_validator

Hazard = Literal["flood", "grid", "air"]
Severity = Literal["normal", "watch", "warning"]

class SensorReading(BaseModel):
    time: datetime
    station_id: str
    hazard: Hazard
    metric: str
    value: float
    unit: str

class HazardReading(SensorReading):
    station_name: str
    lat: float
    lon: float
    severity: Severity | Literal["unrated"]

class Location(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["home", "school", "work", "other"] = "other"
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)

class Routine(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    activity: str = Field(min_length=1, max_length=100)
    location_id: str
    local_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), min_length=1, max_length=7)
    start_date: date | None = None
    duration_minutes: int = Field(default=60, ge=15, le=480)
    recurrence: Literal["none", "weekly"] = "weekly"
    alerts_enabled: bool = True

    @model_validator(mode="after")
    def validate_start_date(self) -> "Routine":
        if self.recurrence == "none" and self.start_date is None:
            raise ValueError("One-time activities require a start date")
        return self

    @field_validator("weekdays")
    @classmethod
    def valid_days(cls, days: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in days):
            raise ValueError("Weekdays must be 0 (Monday) through 6 (Sunday)")
        return sorted(set(days))

class UserPrefs(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    home_lat: float | None = Field(default=None, ge=-90, le=90)
    home_lon: float | None = Field(default=None, ge=-180, le=180)
    work_lat: float | None = Field(default=None, ge=-90, le=90)
    work_lon: float | None = Field(default=None, ge=-180, le=180)
    locations: list[Location] = Field(default_factory=list, max_length=5)
    routines: list[Routine] = Field(default_factory=list, max_length=10)
    timezone: str = "America/Chicago"
    thresholds: dict[str, float] = Field(default_factory=lambda: {"feels_like_f": 95, "us_aqi": 100})
    memory_enabled: bool = False
    notifications_enabled: bool = False
    voice_enabled: bool = False
    @model_validator(mode="after")
    def validate_preferences(self) -> "UserPrefs":
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown timezone") from exc
        ids = [loc.id for loc in self.locations]
        if len(set(ids)) != len(ids) or len({r.id for r in self.routines}) != len(self.routines):
            raise ValueError("Location and routine IDs must be unique")
        if any(r.location_id not in ids for r in self.routines):
            raise ValueError("Each routine must reference a saved location")
        for key, value in self.thresholds.items():
            if key not in {"feels_like_f", "us_aqi"} or not (0 <= value <= 500):
                raise ValueError("Supported thresholds: feels_like_f and us_aqi (0–500)")
        return self

class Suggestion(BaseModel):
    title: str
    description: str
    source_url: str

class Alert(BaseModel):
    id: str
    time: datetime
    user_id: str
    hazard: str
    severity: Severity
    message: str
    channel: str = "dashboard"
    location_id: str | None = None
    station_id: str | None = None
    suggestions: list[Suggestion] = Field(default_factory=list)
    demo: bool = False
    read_at: datetime | None = None


class AlertReadRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    alert_id: int = Field(gt=0)
    read: bool

class ConversationTurn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=3000)

class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    user_id: str | None = Field(default=None, max_length=100)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=4)

class AskResponse(BaseModel):
    answer: str
