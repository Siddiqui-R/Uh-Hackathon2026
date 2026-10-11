"""Small, deterministic CPU detector for station measurements.

An unusual reading is evidence for review, never a confirmed emergency.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import isfinite
from statistics import mean, pstdev


@dataclass(frozen=True)
class Finding:
    baseline: float
    sample_count: int
    score: float
    method: str
    severity: str


def detect_pm25(value: float, observed_at: datetime, history: list[tuple[datetime, float]],
                now: datetime | None = None) -> Finding | None:
    """Compare a fresh concentration with six or more prior station observations.

    History is scoped to the same station, metric and unit by the caller.
    """
    current_time = now or datetime.now(timezone.utc)
    if (not isfinite(value) or value < 0 or observed_at.tzinfo is None
            or not timedelta(0) <= current_time - observed_at <= timedelta(hours=3)):
        return None
    valid_history = [(stamp, sample) for stamp, sample in history
                     if stamp.tzinfo is not None and isfinite(sample) and sample >= 0
                     and observed_at - timedelta(hours=24) <= stamp < observed_at]
    prior = [sample for _, sample in valid_history]
    if len(prior) < 6 or not any(timedelta(0) < observed_at-stamp <= timedelta(hours=3)
                               for stamp, _ in valid_history):
        return None
    baseline = mean(prior)
    deviation = max(pstdev(prior), 2.0)
    score = (value - baseline) / deviation
    # Require a substantial absolute increase too; tiny changes on stable sensors are noise.
    if value - baseline < 15 or score < 3:
        return None
    return Finding(baseline=baseline, sample_count=len(prior), score=score,
                   method="24h station mean + z-score", severity="warning" if score >= 6 else "watch")


def detect_rising_water(value: float, observed_at: datetime,
                        history: list[tuple[datetime, float]],
                        now: datetime | None = None) -> Finding | None:
    """Flag a substantial one-hour rise in a fresh, observed gage height.

    The caller supplies one station's gage-height readings in feet. This is a
    station trend for review, not an official flood stage or road warning.
    """
    current_time = now or datetime.now(timezone.utc)
    if (not isfinite(value) or observed_at.tzinfo is None
            or not timedelta(0) <= current_time - observed_at <= timedelta(hours=1)):
        return None
    prior = sorted(((stamp, sample) for stamp, sample in history
                    if stamp.tzinfo is not None and isfinite(sample)
                    and observed_at - timedelta(hours=2) <= stamp < observed_at),
                   key=lambda item: item[0])
    if len(prior) < 4 or observed_at - prior[-1][0] > timedelta(minutes=30):
        return None
    anchors = [(stamp, sample) for stamp, sample in prior
               if timedelta(minutes=45) <= observed_at - stamp <= timedelta(minutes=90)]
    if not anchors:
        return None
    anchor_at, baseline = min(anchors, key=lambda item: abs((observed_at - item[0]).total_seconds() - 3600))
    hours = (observed_at - anchor_at).total_seconds() / 3600
    rate = (value - baseline) / hours
    if value - baseline < 0.75 or rate < 0.75:
        return None
    return Finding(baseline=baseline, sample_count=len(prior), score=rate,
                   method="observed gage-height rise (ft/hour)",
                   severity="warning" if rate >= 1.5 else "watch")
