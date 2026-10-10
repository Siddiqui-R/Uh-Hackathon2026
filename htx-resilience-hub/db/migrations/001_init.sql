CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sensor_readings (
    time TIMESTAMPTZ NOT NULL,
    station_id TEXT,
    hazard TEXT,
    metric TEXT,
    value DOUBLE PRECISION,
    unit TEXT
);
SELECT create_hypertable('sensor_readings', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS sensor_readings_station_metric_time_idx
    ON sensor_readings (station_id, metric, time DESC);

CREATE TABLE IF NOT EXISTS alerts (
    time TIMESTAMPTZ NOT NULL,
    user_id TEXT,
    hazard TEXT,
    severity TEXT,
    message TEXT,
    channel TEXT
);
SELECT create_hypertable('alerts', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS alerts_user_time_idx ON alerts (user_id, time DESC);

CREATE TABLE IF NOT EXISTS user_prefs (
    user_id TEXT PRIMARY KEY,
    home_lat DOUBLE PRECISION,
    home_lon DOUBLE PRECISION,
    work_lat DOUBLE PRECISION,
    work_lon DOUBLE PRECISION,
    thresholds JSONB DEFAULT '{}'::jsonb
);

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_station_avg
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 hour', time) AS bucket,
       station_id, metric, AVG(value) AS avg_value
FROM sensor_readings
GROUP BY bucket, station_id, metric
WITH NO DATA;

SELECT add_continuous_aggregate_policy('hourly_station_avg',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE);
-- TODO: Add retention policies and backfill older aggregate windows as ingestion grows.
