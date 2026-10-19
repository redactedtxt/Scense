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
# It replaces the catalogue tables only (families, fragrances, notes, their links,
# pair_scores, and the two search-alias tables). llm_usage is left alone. The search
# vectors travel inside the fragrances table. See DECISIONS.md B22 before running it
# once pass 2 accounts exist: TRUNCATE ... CASCADE would also empty tables that
# point at fragrances (collections, reviews, pair ratings).
#
# At 1,000 fragrances the load holds an exclusive lock on the catalogue tables for the
# whole transaction (about 1 to 3 minutes on the t3.small, an estimate), so catalogue and
# pairing requests wait until it commits. Run it when the site is quiet. See DECISIONS B29.
#
# What it checks and does beyond the plain copy (DECISIONS B28, B29):
#   - Before touching production, every fragrance already there must have the same id AND
#     slug in your local database. Guests' saved Own/Want lists store these ids, so a
#     mismatch stops the script before anything is truncated.
#   - The dump is gzipped before upload (about a third of the size at 1,000 fragrances).
#   - SSH sends keepalives, so a quiet connection during the long load is not dropped.
#   - After the load the id sequences are moved past the highest id, because a data-only
#     dump does not carry them and a later insert would otherwise reuse an id.

param(
    [string]$KeyPath = "$HOME\.ssh\ScenseKeyPair.pem",
    [string]$HostName = "scense.name",
    [string]$User = "ubuntu"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$tables = "families", "fragrances", "notes", "fragrance_notes", "fragrance_accords", "pair_scores", "brand_aliases", "name_aliases"
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

# 1. Dump inside the container, gzip it there, and copy the file out. Redirecting pg_dump's
#    output through PowerShell could re-encode accented names (Hermès); a file copy can't.
$tableArgs = $tables | ForEach-Object { "--table=$_" }
docker compose exec -T db pg_dump -U scense -d scense --data-only @tableArgs --file=/tmp/catalogue.sql
docker compose exec -T db gzip -f /tmp/catalogue.sql
docker compose cp db:/tmp/catalogue.sql.gz $dumpFile
docker compose exec -T db rm -f /tmp/catalogue.sql.gz
Write-Host "Dumped and gzipped $((Get-Item $dumpFile).Length) bytes from the local database."

# 2. Upload it to the server.
scp @sshOptions $dumpFile "${target}:/opt/scense/catalogue.sql.gz"

# 3. Load it. TRUNCATE and the data run in one transaction (-1), so a failure leaves
#    the old catalogue in place. ON_ERROR_STOP makes the first error abort the load.
#    The sequence reset uses $$ quoting so the SQL has no single quotes inside the
#    single-quoted -c argument.
$truncate = "TRUNCATE " + ($tables -join ", ") + " CASCADE"
$resetSequences = 'SELECT setval($$fragrances_id_seq$$, (SELECT max(id) FROM fragrances)), setval($$notes_id_seq$$, (SELECT max(id) FROM notes))'
$counts = 'SELECT (SELECT count(*) FROM fragrances) || $$,$$ || (SELECT count(*) FROM pair_scores)'
$remote = @(
    "set -eu",
    "cd /opt/scense",
    "gunzip -f catalogue.sql.gz",
    "$compose cp catalogue.sql db:/tmp/catalogue.sql",
    "$compose exec -T db psql -U scense -d scense -1 -v ON_ERROR_STOP=1 -c '$truncate' -f /tmp/catalogue.sql",
    "$compose exec -T db psql -U scense -d scense -c '$resetSequences'",
    "$compose exec -T db psql -U scense -d scense -c 'ANALYZE'",
    "$compose exec -T db rm /tmp/catalogue.sql",
    "rm catalogue.sql",
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
