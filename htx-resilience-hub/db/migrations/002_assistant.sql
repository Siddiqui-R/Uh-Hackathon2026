-- Existing duplicate observations are retained; workers skip their identity.
CREATE TABLE IF NOT EXISTS reading_identities (
    time TIMESTAMPTZ NOT NULL, station_id TEXT NOT NULL,
    hazard TEXT NOT NULL, metric TEXT NOT NULL,
    PRIMARY KEY (time, station_id, hazard, metric)
);
INSERT INTO reading_identities SELECT DISTINCT time, station_id, hazard, metric
FROM sensor_readings WHERE station_id IS NOT NULL AND hazard IS NOT NULL AND metric IS NOT NULL
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS stations (
    station_id TEXT PRIMARY KEY, station_name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL
);
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS assistant_id TEXT;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS memory_id TEXT;
CREATE TABLE IF NOT EXISTS forecast_snapshots (
    retrieved_at TIMESTAMPTZ NOT NULL, valid_at TIMESTAMPTZ NOT NULL,
    location_id TEXT NOT NULL, metric TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL, source TEXT NOT NULL,
    PRIMARY KEY (retrieved_at, valid_at, location_id, metric)
);
SELECT create_hypertable('forecast_snapshots', 'retrieved_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS forecasts_location_valid_idx ON forecast_snapshots (location_id, valid_at, retrieved_at DESC);
CREATE TABLE IF NOT EXISTS alert_events (
    id BIGSERIAL PRIMARY KEY, dedup_key TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL, time TIMESTAMPTZ NOT NULL DEFAULT now(), payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_events_user_id_idx ON alert_events (user_id, id);
CREATE TABLE IF NOT EXISTS job_status (
    job TEXT PRIMARY KEY, heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_success TIMESTAMPTZ, status TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0
);
