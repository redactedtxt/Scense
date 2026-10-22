# Build from the repo root: docker build -f api/Dockerfile --target prod .
# (the root context lets the image include pipeline/config/scoring.yaml and occasions.yaml).

# Dev image: installs dependencies once; source is bind-mounted by docker-compose.
FROM node:24-alpine AS dev
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ .
# The API scores notes with the same numbers as the pipeline, and the concierge reads its
# occasions. It looks for both files in ../pipeline/config/ relative to /app. Compose
# bind-mounts the live folder over these copies in dev; production uses the copies, so it
# needs no mount.
COPY pipeline/config/scoring.yaml pipeline/config/occasions.yaml /pipeline/config/
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Runtime image (CI and production). Production mounts nothing, so the migrations
# ride along in the image at the path `npm run migrate` expects (../db/migrations).
FROM dev AS prod
ENV NODE_ENV=production
COPY db/migrations /db/migrations
CMD ["npm", "start"]
