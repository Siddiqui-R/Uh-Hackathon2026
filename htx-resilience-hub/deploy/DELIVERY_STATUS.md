# Noach delivery status

Checked October 11, 2026. Production deploys from `main`; feature-branch changes are not live until merged and deployed.

## Verified

- `https://noach.select/`, `/signup`, `/login`, `/api/public/overview`, and `https://noach-api.vercel.app/health` returned HTTP 200.
- Signed-out requests to `/routines`, `/recommendations`, and `/monitor` returned to `/login` with the requested path in `next`.
- The public overview returned modeled weather/AQI values and a bayou gauge reading labeled `live`.
- The frontend type check and all 53 Python API tests passed for the planner-storage feature branch. The planner API now round-trips date, duration, recurrence, and per-activity alert preference, including legacy weekly routines. This is not a production verification until deployed.

## Still to verify

- On a second device, complete signup, login, password-reset email and token use, protected-page return, account isolation, planner save/reload, mobile layout, and browser notification permission. Automated account tests pass, but these production journeys have not been observed end to end.
- AirNow station ingestion needs a server-side provider check with the configured key and a recent `air_ingestion` job result. Modeled AQI and bayou observations do not establish live AirNow station coverage.
- Backboard memory and ElevenLabs voice need opt-in, server-side credential checks and live interaction. Until verified, treat them as optional or unavailable.
- Vercel has no continuous worker. Request-triggered maintenance does not guarantee unattended alerts; choose a scheduler or worker before claiming that behavior.
- The current login UI has no anonymous full-feature demo path. The public dashboard is accessible without signup; protected feature pages require an account.
- GitHub issue #6 was updated with the Vercel checkpoint. Keep its open acceptance checks current as production verification progresses.

## Deployment notes

The production workflow is [`.github/workflows/deploy-vercel.yml`](../../.github/workflows/deploy-vercel.yml). It runs backend tests and deploys two separately packaged Vercel projects from `main`, then checks the public endpoints. Its API entrypoint imports FastAPI and does not execute `apps.api.migrate`; run and confirm required migrations explicitly before a schema-changing deployment. The planner-storage change needs no database migration because preferences are stored as JSON.
