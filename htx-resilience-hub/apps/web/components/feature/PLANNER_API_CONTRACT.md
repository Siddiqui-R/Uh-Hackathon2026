# Planner API handoff

The feature UI deliberately does not send a partial save to the existing preferences endpoint. The current `Routine` model drops the fields needed for a dated activity. The owner of the shared API files should make these narrowly scoped changes:

1. In `apps/api/models.py`, extend `Routine` with `start_date: date | None = None`, `duration_minutes: int = Field(default=60, ge=15, le=480)`, `recurrence: Literal["none", "weekly"] = "weekly"`, and `alerts_enabled: bool = True`. Keep existing `id`, `activity`, `location_id`, `local_time`, and `weekdays` fields. Require `start_date` for `recurrence="none"`; allow legacy weekly routines without it. `start_date` is a local calendar date in the `UserPrefs.timezone`.
2. In the existing `GET /api/prefs` response in `apps/api/main.py`, add `"planner_schema_version": 2` once the model and persistence round trip are ready. The web planner enables saving only when it sees that marker. The existing `POST /api/prefs` can persist the new fields through `UserPrefs.model_dump()` with no new endpoint or account migration.
3. Confirm `POST /api/prefs` returns the new fields unchanged. `apps/api/recommendations.py` already schedules one-time and weekly plans, considers the whole duration, and screens alternatives for threshold breaches and high rain chance. `apps/api/workers.py` already respects per-activity alert opt-out and skips past one-time activities.

No account or session file needs to change. The dashboard owner can add a monitor summary to `apps/web/app/page.tsx` or its shared workspace component; this feature branch leaves both shared files untouched.
