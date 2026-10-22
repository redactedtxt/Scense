#!/usr/bin/env bash
# Loads the small test catalogue into an EMPTY database (M11; DECISIONS B39): every
# migration, then db/test-catalogue.sql.gz through scripts/seed/merge.sql, the same merge
# that seeds production. CI runs this against its throwaway Postgres service.
#
#   DATABASE_URL=postgres://scense:scense_dev@localhost:5432/scense_test scripts/test-catalogue/load.sh
#
# No psql on your machine (Windows)? Set PSQL_CONTAINER to the dev database container,
# and the SQL runs through that container's psql (localhost then means the container):
#   PSQL_CONTAINER=scense-db-1 DATABASE_URL=... scripts/test-catalogue/load.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the empty test database}"
cd "$(dirname "$0")/../.."

# node-pg-migrate prints every migration's SQL; errors still reach the terminal (stderr).
(cd api && npm run --silent migrate > /dev/null)

psql_cmd=(psql "$DATABASE_URL")
if [ -n "${PSQL_CONTAINER:-}" ]; then
  psql_cmd=(docker exec -i "$PSQL_CONTAINER" psql "$DATABASE_URL")
fi

# One transaction (-1): the dump recreates the `seed` schema, merge.sql copies it into
# the real tables and drops it. Any error rolls the whole load back.
{ gzip -dc db/test-catalogue.sql.gz; cat scripts/seed/merge.sql; } \
  | "${psql_cmd[@]}" -q -1 -v ON_ERROR_STOP=1 -f - > /dev/null
"${psql_cmd[@]}" -tA -c "SELECT 'Loaded ' || count(*) || ' fragrances.' FROM fragrances"
