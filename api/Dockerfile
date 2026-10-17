# Build from the repo root: docker build -f api/Dockerfile --target prod .
# (the root context lets the image include pipeline/config/scoring.yaml).

# Dev image: installs dependencies once; source is bind-mounted by docker-compose.
FROM node:24-alpine AS dev
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ .
# The API scores notes with the same numbers as the pipeline. It looks for the file at
# ../pipeline/config/scoring.yaml relative to /app. Compose bind-mounts the live file over
# this copy in dev; production uses the copy, so it needs no mount.
COPY pipeline/config/scoring.yaml /pipeline/config/scoring.yaml
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Runtime image (CI and production). Production mounts nothing, so the migrations
# ride along in the image at the path `npm run migrate` expects (../db/migrations).
FROM dev AS prod
ENV NODE_ENV=production
COPY db/migrations /db/migrations
CMD ["npm", "start"]
