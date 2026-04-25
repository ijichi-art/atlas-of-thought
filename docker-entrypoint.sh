#!/bin/sh
set -e

# Run DB migrations before starting the server.
# 'migrate deploy' is idempotent: safe to run on every container start.
echo "Running database migrations…"
npx prisma migrate deploy

exec "$@"
