# Dev image: installs dependencies once; source is bind-mounted by docker-compose.
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Build stage: produces static files in /app/dist (Caddy serves them from M6).
FROM dev AS build
RUN npm run build
