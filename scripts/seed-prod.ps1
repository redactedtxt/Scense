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
# and pair_scores). llm_usage is left alone. See DECISIONS.md B22 before running it
# once pass 2 accounts exist: TRUNCATE ... CASCADE would also empty tables that
# point at fragrances (collections, reviews, pair ratings).

param(
    [string]$KeyPath = "$HOME\.ssh\ScenseKeyPair.pem",
    [string]$HostName = "scense.name",
    [string]$User = "ubuntu"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$tables = "families", "fragrances", "notes", "fragrance_notes", "fragrance_accords", "pair_scores"
$dumpFile = Join-Path ([IO.Path]::GetTempPath()) "scense-catalogue.sql"
$target = "$User@$HostName"

# 1. Dump inside the container and copy the file out. Redirecting pg_dump's output
#    through PowerShell could re-encode accented names (Hermès), a file copy can't.
$tableArgs = $tables | ForEach-Object { "--table=$_" }
docker compose exec -T db pg_dump -U scense -d scense --data-only @tableArgs --file=/tmp/catalogue.sql
docker compose cp db:/tmp/catalogue.sql $dumpFile
Write-Host "Dumped $((Get-Item $dumpFile).Length) bytes from the local database."

# 2. Upload it to the server.
scp -i $KeyPath $dumpFile "${target}:/opt/scense/catalogue.sql"

# 3. Load it. TRUNCATE and the data run in one transaction (-1), so a failure leaves
#    the old catalogue in place. ON_ERROR_STOP makes the first error abort the load.
$truncate = "TRUNCATE " + ($tables -join ", ") + " CASCADE"
$compose = "docker compose -f docker-compose.prod.yml"
$remote = @(
    "set -eu",
    "cd /opt/scense",
    "$compose cp catalogue.sql db:/tmp/catalogue.sql",
    "$compose exec -T db psql -U scense -d scense -1 -v ON_ERROR_STOP=1 -c '$truncate' -f /tmp/catalogue.sql",
    "$compose exec -T db psql -U scense -d scense -c 'ANALYZE'",
    "$compose exec -T db rm /tmp/catalogue.sql",
    "rm catalogue.sql",
    "$compose exec -T db psql -U scense -d scense -tA -c 'SELECT count(*) FROM fragrances'"
) -join " && "
$count = ssh -i $KeyPath $target $remote | Select-Object -Last 1
Remove-Item $dumpFile

Write-Host "Production now has $count fragrances."
