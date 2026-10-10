"""Validated payloads shared across hazard and preference routes."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

Hazard = Literal["flood", "grid", "air"]
Severity = Literal["unknown", "low", "moderate", "high", "critical"]


class SensorReading(BaseModel):
    time: datetime
    station_id: str
    hazard: Hazard
    metric: str
    value: float
    unit: str


class Alert(BaseModel):
    time: datetime
    user_id: str
    hazard: Hazard
    severity: Severity
    message: str
    channel: Literal["dashboard", "voice", "email", "sms"] = "dashboard"


class UserPrefs(BaseModel):
    user_id: str
    home_lat: float | None = Field(default=None, ge=-90, le=90)
    home_lon: float | None = Field(default=None, ge=-180, le=180)
    work_lat: float | None = Field(default=None, ge=-90, le=90)
    work_lon: float | None = Field(default=None, ge=-180, le=180)
    thresholds: dict[str, float] = Field(default_factory=dict)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    user_id: str | None = None


class AskResponse(BaseModel):
    answer: str


class HazardSummary(BaseModel):
    hazard: Hazard
    severity: Severity = "unknown"
    latest: SensorReading | None = None
    history: list[SensorReading] = Field(default_factory=list)
