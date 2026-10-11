# Noach

A personal Houston environmental assistant: save places and routines, plan outdoor activities with weather and modeled air quality, review observed bayou and AirNow PM2.5 station conditions, and receive relevant alerts. Station anomalies are unusual readings requiring review, not confirmed emergencies. Live grid and road-closure ingestion are deferred.

Team progress: [current delivery status](deploy/DELIVERY_STATUS.md) and [GitHub issue #6](https://github.com/Siddiqui-R/Uh-Hackathon2026/issues/6).

## Local setup

Use Node.js 24, Python 3.12, and optionally Docker Compose v2. Run from this directory.

```powershell
Copy-Item .env.example .env
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/api/requirements.txt
# Configure DATABASE_URL and optional providers in the ignored .env.
.\.venv\Scripts\python.exe -m apps.api.migrate
.\.venv\Scripts\python.exe tools/dev.py
```

Open http://localhost:3000. The supervisor runs the frontend, API and workers. On Linux/macOS use .venv/bin/python instead. Separate terminals can run `npm run dev`, `uvicorn apps.api.main:app --reload`, and `python -m apps.api.workers`. Windows without reload should use `python -m apps.api.run` for psycopg's compatible event loop. Restart after changing configuration.

Migration `006_accounts.sql` adds first-party accounts, revocable sessions, password reset tokens and assistant conversation history. Run `python -m apps.api.migrate` before signing up. Account signup requires a reachable database even when the anonymous demo is enabled. Sign up at `/signup`, sign in at `/login`, and log out from the header or Settings. Existing anonymous browser data remains in its demo profile; creating an account starts a separate empty profile. It is not automatically copied to the account.

If local signup says “Not Found,” the API on port 8000 is running an older or different app. Stop the old web and API processes, run `.\.venv\Scripts\python.exe tools/dev.py` from this directory, and reload `http://localhost:3000/signup`. The supervisor loads the root `.env` for both services. If signup instead reports a database error, check `DATABASE_URL` and run `.\.venv\Scripts\python.exe -m apps.api.migrate`; an account cannot be created in the temporary memory-only demo.

Passwords use salted PBKDF2-HMAC-SHA256 hashes. Account sessions are opaque, database-backed tokens kept in secure HttpOnly cookies in production; only a SHA-256 hash of each token is stored. Reset links expire after 30 minutes, can be used once, and revoke existing sessions. Configure `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and optionally `SMTP_USERNAME`/`SMTP_PASSWORD` for reset email. SMTP uses STARTTLS. For local development without SMTP, set `NOACH_DEV_RESET_LINKS=true` with `NOACH_ENV=development` to show a reset link in the browser. Never enable that flag in production. These variables belong on the server, never in `NEXT_PUBLIC_*` settings.

When Docker or a database is unavailable, run `python tools/demo_local.py` after installing dependencies, then open http://localhost:3001. This explicit rehearsal runs the API and web frontend without workers or durable storage. It can fetch real Open-Meteo modeled forecasts; the bayou fallback, simulated PM2.5 events, nearby alerts and saved preferences are labeled demo or temporary. Everything in process memory resets when the API restarts. Set `NOACH_DEMO_STORAGE=memory` only for this development path; remove it when `DATABASE_URL` is ready, then run migrations and the normal supervisor. This temporary mode does not verify Tiger Data or worker persistence. The current web UI requires an account for feature pages, including in this local mode; there is no anonymous full-feature demo entry on the login page.

For a local Timescale database: `docker compose up -d db`. The development Compose stack overrides DATABASE_URL to its local database; never use that stack for Tiger Cloud production. A fresh local volume applies all migration files. Existing databases use the migration runner, which tracks applied filenames under an advisory lock.

## Configuration and data

DATABASE_URL is required. Production also requires INTERNAL_API_TOKEN; generate a random token (e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`). Optional integrations need GEMINI_API_KEY plus GEMINI_MODEL, BACKBOARD_API_KEY, ELEVENLABS_API_KEY plus ELEVENLABS_VOICE_ID, and AIRNOW_API_KEY for observed PM2.5 monitoring sites. Provider failures retain usable labeled text and database preferences. The example uses `gemini-3.1-flash-lite`; model availability and quotas vary by Google project, so check AI Studio if requests are rate-limited. Never commit .env, credentials or SSH private keys.

USGS observations cover 08074500, 08074000 and 08075000. Flood inserts claim a unique time/station/hazard/metric identity in the same transaction, avoiding repeated samples. Stations retain USGS metadata. Forecast snapshots use separate retrieval and valid timestamps; weather and AQI from Open-Meteo are model/forecast data, not measured station observations. Apparent temperature is labeled “feels like.” Data older than an hour cannot support a confident recommendation. Hourly flood history reads hourly_station_avg; its hourly refresh can delay recent points.

Workers poll flood and location weather/AQI every 15 minutes, AirNow hourly when configured, and evaluate routines every minute. Activities use America/Chicago by default and local weekdays. Saved forecast thresholds trigger routine alerts; Gemini optionally personalizes explanations. Persistent deduplication keys include user, routine, forecast hour and category. Flood anomaly alerts use observed station changes instead of a fixed gage-height threshold.

Outdoor recommendations compare the planned forecast hour with the first hour within 12 hours, between 6 a.m. and 9 p.m. local time, that has readings below the triggered thresholds. The card displays temperature, feels-like temperature, modeled US AQI, rain chance, forecast freshness and attribution for both times. Missing values remain unavailable; stale or incomplete forecasts do not produce a comparison. The frontend-only preview uses explicitly labeled illustrative values.

With AIRNOW_API_KEY set, the worker requests Houston PM2.5 monitoring-site concentrations hourly from the [AirNow monitoring-site service](https://docs.airnowapi.org/webservices). A bounded 27-hour query seeds the station baseline after first startup; valid observations are stored once and only readings from the last three hours can trigger events. A new reading is compared with at least six prior observations from the same station within 24 hours. The detector requires a fresh recent baseline, an increase of at least 15 µg/m³, and a z-score of at least 3. Results include the baseline and sample count. AirNow observations and Open-Meteo modeled AQI remain separate in the UI. AirNow provider behavior must be verified with your own API key before claiming live station coverage. AirNow recommends its file products for sustained historical data collection; this small-area query is intended for the hackathon prototype.

After adding the key to `.env`, run `python -m apps.api.ingest.air` for a read-only provider check. It reports the number of PM2.5 readings, fresh readings and stations without printing the key or writing to Tiger Data. Then restart the workers and confirm `air_ingestion` in the operations panel before claiming live station coverage.

The labeled PM2.5 simulation passes a synthetic sample and an in-memory baseline through the same detector. It stores a demo anomaly event and may alert profiles with saved places within 10 km; it never writes synthetic samples to sensor_readings. It requires the database and migration `004_anomalies.sql`. The endpoint is available in development demo mode; production requires an explicit `NOACH_ALLOW_SIMULATION=true` setting for a rehearsed public demo. Leave this false otherwise.

After each USGS ingestion, the worker also examines fresh gage-height readings in feet. It needs at least four prior samples, a recent sample within 30 minutes, and an observation roughly one hour earlier. A rise of at least 0.75 ft and 0.75 ft/hour creates a watch event; 1.5 ft/hour creates a warning-level station event. Events and nearby-place alerts have a two-hour cooldown unless a watch escalates. These are unverified station trends, not official flood stages, flood warnings, or road-safety decisions. The separate labeled bayou-rise simulation exercises this path without adding synthetic readings to sensor history.

## Interfaces and privacy

All browser API calls go through Next.js. Signed HttpOnly cookies assign anonymous demo profiles; account users have a separate secure HttpOnly cookie backed by a database session. The web proxy derives the user ID from that session, and the backend checks that account requests target the signed-in owner. Direct backend access requires a private internal token in production. Keep the backend private and configure provider quotas.

The navigation now has separate Dashboard, Places, Routines, Recommendations, Live Monitor, Ask the Assistant, and Settings pages. Signed-out visitors first see a public dashboard at `/`, with a sign-in button in its hero. Its citywide condition cards load non-personal modeled weather/air data and available bayou observations through the server; unavailable, stale, and simulated readings are labeled. Feature pages require sign-in and return visitors to their requested page afterward. After signup, a new user is invited to plan an activity on Routines; they can skip and return later without saving a place or granting notification permission. The planner groups activity, place, local date and time, repeat days, duration, and forecast alerts into one create/edit flow with a summary before saving. Saved places, routines, thresholds, alerts and assistant conversations use the account's ID. The backend retains anonymous demo-profile support, but the current web UI does not offer access to protected features without signup. Account conversation history persists in Tiger Data and loads on the Assistant page. Settings includes display name, thresholds, memory and in-browser notification/voice preferences. Browser notifications still require device permission and an open page.

GET /api/hazards preserves the agreed flat array contract. USGS gage heights are shown as unrated observations because flood stages are specific to each station; no universal height threshold triggers an alert. Earlier fixed-height alerts remain in the database for audit but are excluded from dashboard replay. Fresh rapid-rise anomalies can still create clearly labeled nearby alerts. POST /api/ask keeps a `{question,user_id,history?}` → `{answer}` response, with the user ID supplied by the web proxy. Account history is loaded server-side and cannot be replaced by a client-supplied history. Briefing, prefs, status, history, demo-alert and speech routes support the assistant.

Saving places sends coordinates to Open-Meteo for conditions. Optional Backboard memory synchronizes explicitly saved preferences to a separate assistant per user; failures fall back to Tiger preferences. Gemini receives relevant environmental context and preferences for answers. Voice sends displayed text to ElevenLabs only after audio opt-in. Browser notifications work while the page remains running; closed-browser push is deferred.

Alert history shows read and unread state. Marking an alert read or unread updates `alert_events.read_at` for the current anonymous profile; the state survives reload. The navigation badge counts unread alerts currently loaded in the dashboard. Migration `005_alert_read_state.sql` adds the column without changing existing alert records.

Commute guidance shows nearby gauges and official links. It never verifies route safety: road closures, water on individual roads and complete route coverage are unavailable. NOACH_DEMO_MODE=true enables explicitly labeled development fallbacks; production disables this. Grid remains a labeled deferred integration.

## Vultr deployment

Use Ubuntu with Docker Engine and Compose installed from the official Docker repository. Copy the source to the VM, then configure deploy/.env.example as .env with Tiger Cloud DATABASE_URL, INTERNAL_API_TOKEN, provider settings, DOMAIN=noach.select and a valid ACME_EMAIL.

```sh
chmod 600 .env
docker compose -f compose.production.yml up -d --build
docker compose -f compose.production.yml ps
docker compose -f compose.production.yml logs --tail=50 workers
```

The production stack runs migrations, API, frontend, workers and Caddy. It has restart policies and health checks; only Caddy publishes ports. Allow 80/443 and restrict SSH to trusted operators. In Porkbun create an A record for the root domain pointing to the VM's public IPv4; remove conflicting parking records only after reviewing existing records. Caddy obtains HTTPS once DNS resolves. No local database is created in this stack.

The operations panel shows hosting provider, API/database readiness, latest ingestion, freshness and worker heartbeat without private preferences or keys. A queued demo condition travels through Tiger Cloud → Vultr worker → SSE → the browser. Verify HTTPS on a second device before claiming deployment complete.

## Vercel deployment

The live site is https://noach.select, hosted in the `rabeet1` Vercel account.
`noach-select` hosts Next.js; `noach-api` hosts FastAPI at https://noach-api.vercel.app.
Tiger Cloud remains the database. The backend requires an internal token for all application routes.

Pushing to `main` runs `.github/workflows/deploy-vercel.yml`: backend tests, API deployment,
then frontend deployment and public health checks. Run required database migrations separately
before a schema-changing deployment. The workflow uses the encrypted
GitHub repository secrets `VERCEL_API_TOKEN` and `VERCEL_WEB_TOKEN`, each scoped to its
respective project in the `rabeet` Vercel account. These tokens expire after one year and
must be replaced in GitHub's repository secrets before they expire.
Provider keys remain in Vercel's production environment. Feature-branch pushes do not change
the live site; merge them into `main` to deploy. The workflow can also be run manually from
the repository's Actions tab. Deployment runs are serialized to keep releases in order.

For manual recovery, follow the steps in `.github/workflows/deploy-vercel.yml` from the repository root: run backend tests; package the API and web source into separate directories; write each project's `.vercel/project.json` with its workflow project ID and organization ID; deploy the API first, then the web app with their respective scoped tokens; and verify both public health endpoints. The older bare `npx vercel deploy` commands omitted project linking and tokens and should not be used as a production runbook. Keep tokens and `.env` files out of packaged source.

Set backend production variables `DATABASE_URL`, `INTERNAL_API_TOKEN`, `NOACH_ENV=production`,
`NOACH_DEMO_MODE=false`, `HOSTING_PROVIDER=Vercel`, and the optional provider keys/models.
For password reset, also set `APP_BASE_URL=https://noach.select` and the server-only SMTP variables above.
Set frontend `API_BASE_URL=https://noach-api.vercel.app`, the same `INTERNAL_API_TOKEN`,
`NOACH_ENV=production`, and optional ElevenLabs settings. Apply migrations before deployment
with `python -m apps.api.migrate` using the production database connection. The workflow's
"Deploy API and migrations" label should not be taken as proof that migrations ran: the
packaged Vercel entrypoint only imports the app, so run and verify the migration command
separately for schema changes.

Vercel runs bounded functions rather than the continuous Docker worker. While the dashboard
is open, briefing refreshes run due jobs under a database lock: flood/forecast ingestion at
15-minute intervals and alert evaluation at one-minute intervals. Demo requests also trigger
evaluation. Between visits there is no continuous scheduler; unattended alerts require a
separate worker or scheduler. Alert streams reconnect after four minutes and retain their
event cursor. Voice and Backboard memory are unavailable until their keys are configured.
Deployments use CLI source snapshots generated by the GitHub Actions workflow or the manual commands above.

Porkbun DNS: root A records `216.198.79.1` and `64.29.17.1`; `www` CNAME
`202c49f23a2e50a0.vercel-dns-017.com`. Vercel manages HTTPS for both domains.

## Validation

```sh
npm run typecheck
npm run build
python -m unittest discover -s apps/api/tests -v
python -m compileall -q apps/api
```

Tests cover threshold boundaries, local forecast alignment, missing/stale data, persistence fallback isolation, account creation/login/session rules, user data isolation, deduplication and internal API protection. For one-shot real flood ingestion, export DATABASE_URL and run `python apps/api/ingest/flood.py`; repeated unchanged readings should write zero rows. Scheduling is handled by the worker service, or externally:

```cron
*/15 * * * * /usr/bin/python3 /path/to/flood.py
```

Browser notification permission and optional audio must be checked manually on the demo device, including denied permission and failed playback. See deploy/DEMO.md for the rehearsal sequence.
