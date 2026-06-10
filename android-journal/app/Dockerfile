# The Claude Journal — production image
#
# Multi-stage: deps → build → slim runtime running Next's standalone server.
# Prisma 7 + @prisma/adapter-pg is pure JS (no Rust engines), so Alpine/musl
# is safe. The generated client is NOT committed — `prisma generate` runs in
# the build stage.
#
# Runtime expects (see docker-compose.yml):
#   DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_BASE_URL, GITHUB_CLIENT_ID/SECRET
#   UPLOADS_DIR=/data/uploads, SUBMISSIONS_DIR=/data/submissions (volumes)

# ── deps ────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ───────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ── runtime ─────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root (uid 1001, matching Next.js convention)
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs

# Standalone server + static assets (server.js expects them adjacent)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Writable dirs for logs and (default) file storage; real storage is
# volume-mounted at /data in compose.
RUN mkdir -p logs /data/uploads /data/submissions \
    && chown -R nextjs:nodejs logs /data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
