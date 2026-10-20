# Copies the catalogue from your local dev database to production.
#
# Why this exists: the pipeline needs the Kaggle files, which are gitignored, so
# neither CI nor the server can run it. Instead you run the pipeline on your laptop
# (python pipeline/src/run.py pipeline), then this script ships the result.
#
# Usage (PowerShell, from the repo root, with `docker compose up` running):
#   ./scripts/seed-prod.ps1
#   ./scripts/seed-prod.ps1 -KeyPath "$HOME\.ssh\other.pem" -HostName 3.97.35.62
#
# It replaces the catalogue only (families, fragrances, notes, their links, pair_scores,
# and the two search-alias tables) and never deletes a user's data (DECISIONS B32). The
# catalogue travels in a separate `seed` schema (scripts/seed/stage.sql), and on the server
# scripts/seed/merge.sql updates fragrances in place by id, adds new ones, and refills the
# tables only the pipeline writes. Users, collections, reviews, pair ratings, taste
# profiles, and llm_usage are untouched; pipeline/tests/test_seed_merge.py proves it.
# The search vectors travel inside the fragrances table.
#
# At 1,000 fragrances the load holds a lock on the catalogue tables for the whole
# transaction (about 1 to 3 minutes on the t3.small, an estimate), so catalogue and
# pairing requests wait until it commits. Run it when the site is quiet. See DECISIONS B29.
#
# What it checks and does beyond the plain copy (DECISIONS B28, B29):
#   - Before touching production, every fragrance already there must have the same id AND
#     slug in your local database. Guests' saved lists and users' collections store these
#     ids, so a mismatch stops the script before anything changes. merge.sql repeats the
#     check inside the transaction, so it holds even if this script is bypassed.
#   - The dump is gzipped before upload (about a third of the size at 1,000 fragrances).
#   - SSH sends keepalives, so a quiet connection during the long load is not dropped.
#   - After the load the id sequences are moved past the highest id (merge.sql), because
#     explicit ids never advance a sequence and a later insert would otherwise reuse one.

param(
    [string]$KeyPath = "$HOME\.ssh\ScenseKeyPair.pem",
    [string]$HostName = "scense.name",
    [string]$User = "ubuntu"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$dumpFile = Join-Path ([IO.Path]::GetTempPath()) "scense-catalogue.sql.gz"
$target = "$User@$HostName"
$compose = "docker compose -f docker-compose.prod.yml"
# Keepalives: ask the server for a sign of life every 30 s, give up after 20 misses.
$sshOptions = "-i", $KeyPath, "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=20"

# Single-quoted PowerShell strings, so `$$` (Postgres dollar quoting, used so the SQL has no
# single quotes inside the remote shell's single-quoted -c argument) is left alone.
$idQuery = 'SELECT id || $$,$$ || slug FROM fragrances ORDER BY id'

# 0. Id check. Production's ids are what guests' browsers hold, so every fragrance already
#    there must exist locally under the same id and slug. An empty production passes.
$localIds = @(docker compose exec -T db psql -U scense -d scense -tA -c $idQuery | Where-Object { $_ })
if ($localIds.Count -eq 0) { throw "The local database has no fragrances. Run the pipeline first." }
$prodIds = @(ssh @sshOptions $target "cd /opt/scense && $compose exec -T db psql -U scense -d scense -tA -c '$idQuery'" | Where-Object { $_ })
$localSet = [System.Collections.Generic.HashSet[string]]::new([string[]]($localIds | ForEach-Object { $_.Trim() }))
$mismatch = @($prodIds | ForEach-Object { $_.Trim() } | Where-Object { -not $localSet.Contains($_) })
if ($mismatch.Count -gt 0) {
    throw "Id check failed: $($mismatch.Count) production fragrances differ from your local database (id,slug), for example: $($mismatch[0..([Math]::Min(4, $mismatch.Count - 1))] -join ' | '). Nothing was changed. Rebuild the local database so these ids match (pipeline/config/pinned_ids.csv), then rerun."
}
Write-Host "Id check passed: $($prodIds.Count) production fragrances match local ids; $($localIds.Count) will be loaded."

$localCounts = (docker compose exec -T db psql -U scense -d scense -tA -F "," -c "SELECT (SELECT count(*) FROM fragrances), (SELECT count(*) FROM pair_scores)" | Select-Object -Last 1).Trim()

# 1. Copy the catalogue into a local `seed` schema, dump that schema (tables and data) inside
#    the container, gzip it there, and copy the file out. Redirecting pg_dump's output
#    through PowerShell could re-encode accented names (Hermès); a file copy can't. The
#    local `seed` schema is dropped straight after, so the dev database is left as it was.
docker compose cp scripts/seed/stage.sql db:/tmp/stage.sql
docker compose exec -T db psql -U scense -d scense -q -v ON_ERROR_STOP=1 -f /tmp/stage.sql
docker compose exec -T db pg_dump -U scense -d scense --schema=seed --no-owner --no-privileges --file=/tmp/catalogue.sql
docker compose exec -T db psql -U scense -d scense -q -c "DROP SCHEMA seed CASCADE"
docker compose exec -T db gzip -f /tmp/catalogue.sql
docker compose cp db:/tmp/catalogue.sql.gz $dumpFile
docker compose exec -T db rm -f /tmp/catalogue.sql.gz /tmp/stage.sql
Write-Host "Dumped and gzipped $((Get-Item $dumpFile).Length) bytes from the local database."

# 2. Upload the dump and the merge script to the server.
scp @sshOptions $dumpFile "${target}:/opt/scense/catalogue.sql.gz"
scp @sshOptions scripts/seed/merge.sql "${target}:/opt/scense/merge.sql"

# 3. Load it. Everything runs in one transaction (-1): drop any leftover `seed` schema, let
#    the dump recreate it, then merge.sql copies it into the real tables and drops it. A
#    failure anywhere rolls all of it back and leaves production as it was. ON_ERROR_STOP
#    makes the first error abort the load.
$counts = 'SELECT (SELECT count(*) FROM fragrances) || $$,$$ || (SELECT count(*) FROM pair_scores)'
$remote = @(
    "set -eu",
    "cd /opt/scense",
    "gunzip -f catalogue.sql.gz",
    "$compose cp catalogue.sql db:/tmp/catalogue.sql",
    "$compose cp merge.sql db:/tmp/merge.sql",
    "$compose exec -T db psql -U scense -d scense -1 -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS seed CASCADE' -f /tmp/catalogue.sql -f /tmp/merge.sql",
    "$compose exec -T db psql -U scense -d scense -c 'ANALYZE'",
    "$compose exec -T db rm /tmp/catalogue.sql /tmp/merge.sql",
    "rm catalogue.sql merge.sql",
    "$compose exec -T db psql -U scense -d scense -tA -c '$counts'"
) -join " && "
$prodCounts = (ssh @sshOptions $target $remote | Select-Object -Last 1).Trim()
Remove-Item $dumpFile

# 4. The counts (fragrances,pair_scores) must match what was dumped.
if ($prodCounts -ne $localCounts) {
    throw "Production counts ($prodCounts) differ from local ($localCounts) after the load."
}
$fragranceCount = ($prodCounts -split ",")[0]
Write-Host "Production now has $fragranceCount fragrances ($prodCounts = fragrances,pair_scores)."
