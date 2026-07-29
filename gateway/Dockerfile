# syntax=docker/dockerfile:1
#
# Multi-stage build for the sustainability-data gateway.
#
# Why a Dockerfile rather than Nixpacks (Railway's default builder): this
# service's whole purpose is to be curl-ed by a reviewer, so the build must be
# reproducible and inspectable. A Dockerfile pins the Node major version,
# installs from the lockfile with `npm ci`, ships only production dependencies
# and compiled output, runs as a non-root user, and can be built and tested
# byte-identically on a laptop before it ever reaches Railway. Nixpacks would
# infer most of that, but "infer" is the wrong verb for a deployment someone is
# going to cite. See GUIDE-RAILWAY.md.

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The subject documents. Adding a subject means adding a file here and
# redeploying; no code change and no rebuild of the source is involved.
COPY data ./data

# Run unprivileged (the `node` user ships with the base image).
USER node

# Railway injects PORT; 8080 is the local default.
ENV PORT=8080
EXPOSE 8080

# Liveness. Railway can use its own healthcheckPath (see railway.json) instead;
# this makes `docker run` self-checking too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form: PID 1 is node, so Railway's SIGTERM reaches the process and the
# graceful-shutdown handler in src/index.ts actually runs.
CMD ["node", "dist/index.js"]
