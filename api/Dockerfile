# Dev image: installs dependencies once; source is bind-mounted by docker-compose.
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Runtime image (used by CI and, from M6, production).
FROM dev AS prod
ENV NODE_ENV=production
CMD ["npm", "start"]
