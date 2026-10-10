# noach.select

A personal Houston environmental assistant: save places and routines, plan outdoor activities with weather and modeled air quality, review observed bayou conditions, and receive relevant alerts. The three hazard modules support the recommendations. Live grid and road-closure ingestion are deferred.

Team progress: [delivery checklist](https://github.com/Siddiqui-R/Uh-Hackathon2026/issues/6). Each remaining workstream has an owner, acceptance checks and a linked GitHub issue. Claim your task, check verified steps and close the issue when its acceptance checks pass.

## Local setup

Use Node.js 22+, Python 3.10+, and optionally Docker Compose v2. Run from this directory.

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

For a local Timescale database: `docker compose up -d db`. The development Compose stack overrides DATABASE_URL to its local database; never use that stack for Tiger Cloud production. A fresh local volume applies all migration files. Existing databases use the migration runner, which tracks applied filenames under an advisory lock.

## Configuration and data

DATABASE_URL is required. Production also requires INTERNAL_API_TOKEN; generate a random token (e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`). Optional integrations need GEMINI_API_KEY plus GEMINI_MODEL, BACKBOARD_API_KEY, and ELEVENLABS_API_KEY plus ELEVENLABS_VOICE_ID. Provider failures retain usable labeled text and database preferences. Model availability varies by provider account; choose a supported Gemini model. Never commit .env, credentials or SSH private keys.

USGS observations cover 08074500, 08074000 and 08075000. Flood inserts claim a unique time/station/hazard/metric identity in the same transaction, avoiding repeated samples. Stations retain USGS metadata. Forecast snapshots use separate retrieval and valid timestamps; weather and AQI from Open-Meteo are model/forecast data, not measured station observations. Apparent temperature is labeled “feels like.” Data older than an hour cannot support a confident recommendation. Hourly flood history reads hourly_station_avg; its hourly refresh can delay recent points.

Workers poll flood and location weather/AQI every 15 minutes and evaluate routines every minute. Activities use America/Chicago by default and local weekdays. Threshold rules trigger alerts; Gemini optionally personalizes explanations. Persistent deduplication keys include user, routine, forecast hour and category. Flood escalation state is persisted. Try demo alert queues a labeled condition for the actual worker; it never changes sensor readings.

## Interfaces and privacy

All browser API calls go through Next.js. Signed HttpOnly session cookies assign each browser an anonymous profile; callers cannot select another user's ID through the web proxy. Direct backend access requires an internal token in production. This is an anonymous hackathon prototype, not multi-device account login: each browser has separate preferences. Keep the backend private and configure provider quotas.

GET /api/hazards preserves the agreed flat array contract. Gage heights greater than 15 ft are warning, greater than 10 ft watch, otherwise normal; these prototype thresholds are not official flood stages. POST /api/ask keeps {question,user_id} → {answer}. Briefing, prefs, status, history, demo-alert and speech routes support the assistant.

Saving places sends coordinates to Open-Meteo for conditions. Optional Backboard memory synchronizes explicitly saved preferences to a separate assistant per user; failures fall back to Tiger preferences. Gemini receives relevant environmental context and preferences for answers. Voice sends displayed text to ElevenLabs only after audio opt-in. Browser notifications work while the page remains running; closed-browser push is deferred.

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

From this directory, package source without local credentials and deploy the two projects:

```powershell
.\.venv\Scripts\python.exe tools/package_vercel_api.py ../.deployment/noach-api
.\.venv\Scripts\python.exe tools/package_vercel_web.py ../.deployment/noach-web
npx vercel deploy --prod --yes --scope rabeet1 --cwd ../.deployment/noach-api
npx vercel deploy --prod --yes --scope rabeet1 --cwd ../.deployment/noach-web
```

Set backend production variables `DATABASE_URL`, `INTERNAL_API_TOKEN`, `NOACH_ENV=production`,
`NOACH_DEMO_MODE=false`, `HOSTING_PROVIDER=Vercel`, and the optional provider keys/models.
Set frontend `API_BASE_URL=https://noach-api.vercel.app`, the same `INTERNAL_API_TOKEN`,
`NOACH_ENV=production`, and optional ElevenLabs settings. Apply migrations before deployment
with `python -m apps.api.migrate` using the production database connection.

Vercel runs bounded functions rather than the continuous Docker worker. While the dashboard
is open, briefing refreshes run due jobs under a database lock: flood/forecast ingestion at
15-minute intervals and alert evaluation at one-minute intervals. Demo requests also trigger
evaluation. Between visits there is no continuous scheduler; unattended alerts require a
separate worker or scheduler. Alert streams reconnect after four minutes and retain their
event cursor. Voice and Backboard memory are unavailable until their keys are configured.
These deployments use CLI source snapshots; automatic GitHub deployments are not connected.

Porkbun DNS: root A records `216.198.79.1` and `64.29.17.1`; `www` CNAME
`202c49f23a2e50a0.vercel-dns-017.com`. Vercel manages HTTPS for both domains.

## Validation

```sh
npm run typecheck
npm run build
python -m unittest discover -s apps/api/tests -v
python -m compileall -q apps/api
```

Tests cover threshold boundaries, local forecast alignment, missing/stale data, persistence fallback isolation, deduplication and internal API protection. For one-shot real flood ingestion, export DATABASE_URL and run `python apps/api/ingest/flood.py`; repeated unchanged readings should write zero rows. Scheduling is handled by the worker service, or externally:

```cron
*/15 * * * * /usr/bin/python3 /path/to/flood.py
```

Browser notification permission and optional audio must be checked manually on the demo device, including denied permission and failed playback. See deploy/DEMO.md for the rehearsal sequence.
