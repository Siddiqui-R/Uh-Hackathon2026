CREATE TABLE IF NOT EXISTS flood_alert_state (
    key TEXT PRIMARY KEY, severity TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demo_requests (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ
);
