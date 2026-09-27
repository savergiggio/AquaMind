#!/bin/bash
# Docker entrypoint script for AquaMind backend
# Starts camera feeder in background, then launches Node.js server

set -e

echo "[Entrypoint] AquaMind Backend starting..."

# Start Node.js server
echo "[Entrypoint] Starting Node.js server..."
exec node server.js
