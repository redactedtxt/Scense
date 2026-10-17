#!/bin/sh
# Starts cron, which runs backup.sh every night.
set -eu

# Fail at startup, not at 3 a.m., if a setting is missing.
: "${AWS_BACKUP_BUCKET:?AWS_BACKUP_BUCKET is not set}"
: "${PGPASSWORD:?PGPASSWORD is not set}"

# Cron starts each job with an empty environment, so the job could not see the
# bucket name or database password. Save the variables it needs to a file the
# job reads first. Only root can read the file.
umask 077
export -p | grep -E "^export (PG|AWS_|BACKUP_)" > /etc/backup.env

# Job output goes to PID 1's stdout, so it appears in `docker compose logs backup`.
echo "${BACKUP_SCHEDULE:-0 3 * * *} . /etc/backup.env && /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" \
  > /etc/crontabs/root

echo "backup: scheduled '${BACKUP_SCHEDULE:-0 3 * * *}' ($TZ), bucket $AWS_BACKUP_BUCKET"
exec crond -f -l 8
