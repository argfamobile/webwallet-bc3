#!/bin/sh
# entrypoint.sh — run the startup guard and only then launch ElectrumX-BC3.
set -e

echo "[entrypoint] ElectrumX-BC3 — running header_hash guard (preflight)..."
python3 /opt/preflight.py

echo "[entrypoint] preflight OK -> exec electrumx_server"
exec electrumx_server
