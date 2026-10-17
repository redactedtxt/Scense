#!/bin/sh
# Restores one dump from S3 over the live database. Destructive: it replaces every
# table the dump contains. Run by hand only:
#   docker compose -f docker-compose.prod.yml exec backup restore.sh             # lists dumps
#   docker compose -f docker-compose.prod.yml exec backup restore.sh <file name> # restores one
set -eu

if [ $# -eq 0 ]; then
  aws s3 ls "s3://$AWS_BACKUP_BUCKET/postgres/"
  echo "Pass one of the file names above to restore it."
  exit 0
fi

file="/tmp/restore.dump"
trap 'rm -f "$file"' EXIT
aws s3 cp --only-show-errors "s3://$AWS_BACKUP_BUCKET/postgres/$1" "$file"

# --clean --if-exists drops each object before recreating it; --single-transaction
# means a failed restore leaves the database exactly as it was.
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$PGDATABASE" "$file"
echo "restore: $1 restored into $PGDATABASE"
