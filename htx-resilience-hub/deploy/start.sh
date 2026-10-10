#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
test -f .env || { echo 'Missing .env; copy deploy/.env.example and configure it.' >&2; exit 1; }
chmod 600 .env
docker compose -f compose.production.yml up -d --build
docker compose -f compose.production.yml ps
