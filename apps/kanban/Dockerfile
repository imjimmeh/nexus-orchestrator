# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/kanban/package.json ./apps/kanban/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/kanban-contracts/package.json ./packages/kanban-contracts/package.json
COPY packages/e2e-tests/package.json ./packages/e2e-tests/package.json

RUN npm ci

COPY packages/core ./packages/core
COPY packages/kanban-contracts ./packages/kanban-contracts
COPY apps/kanban ./apps/kanban

# Build the Kanban service and its workspace dependencies in topological order.
RUN npx turbo run build --filter=@nexus/kanban

# Stage 2: Run
FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache git openssh-client

COPY --from=builder /build/package.json /build/package-lock.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/core ./packages/core
COPY --from=builder /build/packages/kanban-contracts ./packages/kanban-contracts
COPY --from=builder /build/apps/kanban/dist ./apps/kanban/dist
COPY --from=builder /build/apps/kanban/package.json ./apps/kanban/package.json

ENV NODE_ENV=production

CMD ["node", "apps/kanban/dist/main.js"]
