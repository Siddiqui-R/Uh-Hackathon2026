ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'USGS';
ALTER TABLE stations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'USGS';

CREATE TABLE IF NOT EXISTS environmental_anomalies (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL,
    station_name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    hazard TEXT NOT NULL,
    metric TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit TEXT NOT NULL,
    baseline DOUBLE PRECISION NOT NULL,
    sample_count INTEGER NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    method TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unverified sensor anomaly',
    observed_at TIMESTAMPTZ NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL,
    is_simulated BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (station_id, metric, observed_at, is_simulated)
);
CREATE INDEX IF NOT EXISTS anomalies_recent_idx ON environmental_anomalies (id DESC);
CREATE INDEX IF NOT EXISTS anomalies_station_time_idx ON environmental_anomalies (station_id, observed_at DESC);
