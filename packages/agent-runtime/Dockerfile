FROM oven/bun:1.2 AS base
LABEL fly_launch_runtime="Bun"
WORKDIR /app

# Install workspace dependencies
COPY package.json pnpm-workspace.yaml ./
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/common/package.json ./packages/common/

# Use bun to install (faster in container)
RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS build
COPY packages/common ./packages/common
COPY packages/sdk ./packages/sdk
COPY packages/agent-runtime ./packages/agent-runtime

RUN cd packages/common && bun run build
RUN cd packages/sdk && bun run build
RUN cd packages/agent-runtime && bun run build

# Production stage
FROM oven/bun:1.2-slim AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/packages/agent-runtime/dist ./dist
COPY --from=build /app/packages/agent-runtime/workspace ./workspace
COPY --from=build /app/packages/agent-runtime/openclaw.json ./openclaw.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3001

CMD ["bun", "run", "dist/index.js"]
