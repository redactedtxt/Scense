# Nightly pg_dump to S3. pg_dump must match the server's major version, so this
# starts from the same Postgres 16 line as the db service.
# Build: docker build backup
FROM postgres:16-alpine

# aws-cli uploads the dump; tzdata lets cron run on Toronto time.
RUN apk add --no-cache aws-cli tzdata

COPY entrypoint.sh backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh /usr/local/bin/restore.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
