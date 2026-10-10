# HTX Resilience Hub

Hackathon monorepo scaffold for Houston flood conditions, power grid stress, and air quality. Next.js 14 (TypeScript strict mode, App Router, Tailwind, Leaflet), FastAPI, and Tiger Data / TimescaleDB. No live hazard feeds, AI calls, user memory, or speech are implemented. Unknown severity means no data, not safe conditions.

## Prerequisites

Node.js 22+, Python 3.11+, and Docker with Compose v2. Run commands below from `htx-resilience-hub/`.

## Quick start with Docker

```sh
cp .env.example .env
npm install
docker compose up --build
```

PowerShell: use `Copy-Item .env.example .env` instead of `cp` if needed. The template includes local development database credentials only; use separate secure values for deployed databases. Do not commit `.env` or provider keys.

Open http://localhost:3000. API health: http://localhost:8000/health; OpenAPI: http://localhost:8000/docs. Compose starts all three services, applies `db/migrations/001_init.sql` on a fresh database volume, and waits for the database to become healthy before starting the API. The web container runs the development server for this scaffold.

## Run web and API locally

Start only the database (avoid running container and local servers on the same ports):

```sh
cp .env.example .env
docker compose up -d db
npm install
npm run dev
```

In another terminal, from the monorepo root:

```sh
python -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows PowerShell instead:
# .\.venv\Scripts\Activate.ps1
python -m pip install -r apps/api/requirements.txt
uvicorn apps.api.main:app --reload
```

Alternatively, after activating the environment, `cd apps/api` and run `uvicorn main:app --reload`. Both entry points load the root `.env`. Next.js also loads the root `.env` for server-side routes. Restart servers after changing environment values.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required at API startup; host development defaults to localhost. Set to your Tiger Data connection URL (including SSL parameters) to use a hosted database. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local Compose database settings. Compose constructs the API database URL with hostname `db`. URL-encode credentials if they contain URL-reserved characters. |
| `API_BASE_URL` | Required when a Next.js proxy route is called. Local host uses `http://127.0.0.1:8000`; Compose sets `http://api:8000`. |
| `GEMINI_API_KEY` | Required when `/api/ask` is invoked; a configured key still returns 501 until the integration is implemented. |
| `ELEVENLABS_API_KEY` | Required when the server-only `speak(text)` stub is invoked. |
| `BACKBOARD_API_KEY` | Required when server-only user memory stubs are invoked. |

Keys stay server-side and are never prefixed with `NEXT_PUBLIC_`. Missing settings produce named configuration errors. Provider stubs explicitly fail instead of pretending a remote operation succeeded. The API can start without provider keys.

## Layout

```text
apps/web/                  Next.js dashboard, /api proxies, server-only provider stubs
apps/api/                  FastAPI entry, async psycopg access, pydantic models
apps/api/ingest/            Flood, grid, and air ingestion stubs (not scheduled)
db/migrations/001_init.sql  Hypertables, preferences, hourly continuous aggregate
docker-compose.yml         Local db, api, and web services
.env.example               Environment template; no real credentials
```

The browser accesses FastAPI only through Next.js `/api/hazards`, `/api/ask`, and `/api/alerts`. Leaflet loads public OpenStreetMap base tiles directly. Layer toggles are UI placeholders. Alert SSE sends a `ready` event and 15-second heartbeat comments; it does not generate fake hazard alerts. Ingestion functions return empty typed lists and do not run automatically.

API routes: `GET /health`, `GET /api/hazards`, `POST /api/ask` (`question`, optional `user_id`), `GET /api/alerts`. Authentication and user-scoped access are TODOs before deployment.

## Database

`sensor_readings` has 1-day time chunks; `alerts` is another hypertable. `user_prefs` is a regular table. `hourly_station_avg` groups by hourly bucket, station ID, and metric, refreshing hourly across the previous seven days with a one-hour delay. For older history, explicitly refresh the aggregate after backfilling.

The init script only runs automatically for a fresh volume. To apply it manually to the local database:

```sh
docker compose exec -T db psql -U htx -d htx < db/migrations/001_init.sql
```

PowerShell equivalent (adjust user/database if changed):

```powershell
Get-Content db/migrations/001_init.sql -Raw | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U htx -d htx
```

For hosted Tiger Data, apply the same SQL using a client configured with `DATABASE_URL`; do not put connection strings in committed scripts.

## Checks

```sh
npm run typecheck
npm run build
python -m compileall apps/api
```

Every integration stub has a one-line TODO. Implement ingestion, SQL queries, Gemini grounding, user memory, speech playback, real map overlays, and authenticated alert delivery during the hackathon.
