# Production web server: Caddy with the built web app and the Caddyfile baked in,
# so the server needs no files besides docker-compose.prod.yml.
# Build from the repo root: docker build -f caddy/Dockerfile .

# Stage 1: build the React app into static files.
FROM node:24-alpine AS web-build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# Stage 2: Caddy serves those files and proxies /api to the API container.
FROM caddy:2.11-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/dist /srv/web
