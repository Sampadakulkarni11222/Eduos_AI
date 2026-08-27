# ── build ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copied separately so a source-only change does not invalidate the dependency
# layer, which is by far the slowest part of the build.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only: the built bundle still requires the runtime
# packages, but nothing from devDependencies ships.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# The image runs as a non-root user; `node` already exists in this base image.
RUN mkdir -p logs && chown -R node:node /app
USER node

EXPOSE 5000

# `npm start` would add a shell and swallow signals; running node directly makes
# the process PID 1 so it receives SIGTERM and can shut down cleanly.
CMD ["node", "dist/app.js"]
