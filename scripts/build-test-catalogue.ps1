# Rebuilds db/test-catalogue.sql.gz, the small catalogue CI loads for the API integration
# tests and the Playwright smoke tests (M11; DECISIONS B39).
#
# Why this exists: CI has no Kaggle files, so it can't run the pipeline, and the full
# catalogue is 44 MB. This copies about 125 bottles (scripts/test-catalogue/stage.sql
# says which) from your local database, which the pipeline has loaded.
#
# Usage (PowerShell, from the repo root, with `docker compose up` running):
#   ./scripts/build-test-catalogue.ps1
# Rerun it after a pipeline change that the tests should see, and commit the new file.

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$outFile = "db/test-catalogue.sql.gz"

# The same steps as seed-prod.ps1's dump: stage into a `seed` schema, dump it inside the
# container (so PowerShell never re-encodes Hermès), drop the schema again.
docker compose cp scripts/test-catalogue/stage.sql db:/tmp/stage.sql
docker compose exec -T db psql -U scense -d scense -q -v ON_ERROR_STOP=1 -f /tmp/stage.sql
docker compose exec -T db pg_dump -U scense -d scense --schema=seed --no-owner --no-privileges --file=/tmp/test-catalogue.sql
docker compose exec -T db psql -U scense -d scense -q -c "DROP SCHEMA seed CASCADE"

# pg_dump 16.10 and later wraps the dump in \restrict and \unrestrict lines, which older
# psql clients (such as the one on a CI runner) refuse. They guard against a malicious
# server's dump; this file is our own and is reviewed in git, so they are removed.
# -n leaves the time out of the gzip header, so an unchanged catalogue gives the same file.
docker compose exec -T db sh -c "grep -v -e '^\\restrict ' -e '^\\unrestrict ' /tmp/test-catalogue.sql | gzip -n -9 > /tmp/test-catalogue.sql.gz"
docker compose cp db:/tmp/test-catalogue.sql.gz $outFile
docker compose exec -T db rm -f /tmp/test-catalogue.sql /tmp/test-catalogue.sql.gz /tmp/stage.sql
Write-Host "Wrote $outFile ($((Get-Item $outFile).Length) bytes)."
