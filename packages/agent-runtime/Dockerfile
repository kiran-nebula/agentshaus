FROM node:22-slim AS base
WORKDIR /app

# Install pnpm + bun
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN npm install -g bun

# Copy monorepo config + lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/common/package.json ./packages/common/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/

# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/common ./packages/common
COPY packages/sdk ./packages/sdk
COPY packages/agent-runtime ./packages/agent-runtime

# Build common + sdk (they emit to dist/)
RUN pnpm --filter @agents-haus/common run build
RUN pnpm --filter @agents-haus/sdk run build

# Production stage — slim image with bun for runtime
FROM oven/bun:1.2-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts + source for agent-runtime (Bun runs TS directly)
COPY --from=base /app/packages/common ./packages/common
COPY --from=base /app/packages/sdk ./packages/sdk
COPY --from=base /app/packages/agent-runtime ./packages/agent-runtime
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/tsconfig.base.json ./tsconfig.base.json

EXPOSE 3001

WORKDIR /app/packages/agent-runtime
CMD ["bun", "run", "src/index.ts"]
