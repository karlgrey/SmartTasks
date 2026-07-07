#!/bin/sh
set -e
if [ -n "$LITESTREAM_REPLICA_URL" ]; then
	litestream restore -if-db-not-exists -if-replica-exists "$DATABASE_PATH"
	exec litestream replicate -exec "node build"
else
	exec node build
fi
