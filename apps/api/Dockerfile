# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/kanban-contracts/package.json ./packages/kanban-contracts/package.json
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY packages/e2e-tests/package.json ./packages/e2e-tests/package.json
COPY packages/gitops-contracts/package.json ./packages/gitops-contracts/package.json

# Install dependencies for the whole monorepo using the root lockfile.
RUN npm ci

COPY packages/core ./packages/core
COPY packages/kanban-contracts ./packages/kanban-contracts
COPY packages/plugin-sdk ./packages/plugin-sdk
COPY packages/gitops-contracts ./packages/gitops-contracts
COPY apps/api ./apps/api
COPY seed ./seed

# Build the API and its workspace dependencies in topological order.
RUN npx turbo run build --filter=api

# Stage 2: Run
FROM node:24-alpine

RUN apk add --no-cache git

WORKDIR /app

# Copy built artifacts and node_modules
COPY --from=builder /build/package.json /build/package-lock.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /build/packages/core ./packages/core
COPY --from=builder /build/packages/kanban-contracts ./packages/kanban-contracts
COPY --from=builder /build/packages/plugin-sdk ./packages/plugin-sdk
COPY --from=builder /build/packages/gitops-contracts ./packages/gitops-contracts
COPY --from=builder /build/apps/api/dist ./apps/api/dist
COPY --from=builder /build/apps/api/package.json ./apps/api/package.json
COPY --from=builder /build/seed ./seed

# Set environment defaults
ENV NODE_ENV=production

# Start from the built dist
CMD ["node", "apps/api/dist/main.js"]
