# =============================================================================
# Claw-Empire — Multi-stage Docker build
# =============================================================================
# Stage 1: Install dependencies + build frontend
# Stage 2: Lean production image
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build frontend
COPY . .
RUN pnpm build

# Install runtime-needed packages that are listed as devDependencies
# sharp: used for sprite generation at runtime
# tsx: TypeScript execution for server
RUN pnpm prune --prod && pnpm add sharp tsx

# ---------------------------------------------------------------------------
# Stage 2 — production
# ---------------------------------------------------------------------------
FROM node:22-slim AS production

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# Install git (needed for worktree operations)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production node_modules from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Copy built frontend
COPY --from=build /app/dist ./dist

# Copy server source (tsx runs TypeScript directly)
COPY --from=build /app/server ./server
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/tsconfig.node.json ./

# Copy public assets, scripts, templates
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/templates ./templates

# Create data directories
RUN mkdir -p /data/db /data/logs /data/worktrees && \
    chown -R node:node /data /app

# Run as non-root
USER node

# Default environment for Docker deployment
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8790 \
    DB_PATH=/data/db/claw-empire.sqlite \
    LOGS_DIR=/data/logs \
    REMOTION_RUNTIME_BOOTSTRAP=0 \
    CLAW_MIGRATION_V1_0_5_DONE=1

# Volumes for persistent data
VOLUME ["/data"]

EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8790/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

# Skip pnpm prestart hooks (Remotion bootstrap not needed in Docker).
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
