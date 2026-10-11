# Planner API contract

Implemented on the `codex/planner-storage` feature branch. This contract is not active in production until the branch is merged and deployed.

- `Routine` keeps `id`, `activity`, `location_id`, `local_time`, and `weekdays`, and adds `start_date: date | None`, `duration_minutes` (15–480, default 60), `recurrence` (`none` or `weekly`, default `weekly`), and `alerts_enabled` (default `true`). A one-time activity requires `start_date`; legacy weekly routines may omit it. Dates are local calendar dates in `UserPrefs.timezone`.
- `GET /api/prefs` includes `planner_schema_version: 2` when the updated API is deployed. The planner enables dated saves only with that marker.
- `POST /api/prefs` returns the new fields and stores them in the existing JSON preferences document. No database migration is needed. Round-trip tests cover the API and database serialization paths.
- Recommendations use saved start date, recurrence, and duration. Alert evaluation uses the saved duration and per-activity opt-out and skips past one-time activities.

Production planner save/reload remains an acceptance check after deployment. See [delivery status](../../../../deploy/DELIVERY_STATUS.md).
