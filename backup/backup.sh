#!/bin/sh
# Dumps the database and uploads it to s3://$AWS_BACKUP_BUCKET/postgres/.
# Run by cron each night; run it by hand with:
#   docker compose -f docker-compose.prod.yml exec backup backup.sh
#
# There is no cleanup step on purpose: the bucket's lifecycle rule deletes dumps
# after 14 days, so the server's IAM role never needs permission to delete.
set -eu

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
file="/tmp/scense-$stamp.dump"
key="postgres/scense-$stamp.dump"
# Delete the local copy however the script ends, so failed nights don't fill the disk.
trap 'rm -f "$file"' EXIT

# Custom format is compressed and lets pg_restore pick tables later.
# Dump to a file first: if pg_dump fails halfway, nothing half-written reaches S3.
pg_dump --format=custom --file="$file"

# A dump pg_restore cannot read is no backup, so check before uploading.
pg_restore --list "$file" > /dev/null

aws s3 cp --only-show-errors "$file" "s3://$AWS_BACKUP_BUCKET/$key"
size=$(wc -c < "$file")

echo "backup: uploaded $key ($size bytes)"
