# ── build ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so the backend URL has to be
# known here rather than at container start.
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL

RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.mjs ./
# No `public/` copy: this app has no public directory — static assets live in
# src/app (icon.svg) and are emitted into .next. Adding a COPY for a path that
# does not exist would fail the build.

USER node
EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]
