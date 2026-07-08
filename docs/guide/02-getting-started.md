# 02 — Getting Started

Developer onboarding guide: prerequisites, clone and install, build order, running the stack, running tests, linting, and common issues. Follow this from top to bottom for a working local development environment.

---

## Prerequisites

| Tool       | Minimum Version | Notes                                                          |
| ---------- | --------------- | -------------------------------------------------------------- |
| Node.js    | 24+             | Required for all services and packages                         |
| npm        | 10+             | Workspaces support required (`npm workspaces`)                 |
| PostgreSQL | 18+             | Primary data store (port 5433 in Docker, 5432 natively)        |
| Redis      | 7+              | BullMQ queues and pub-sub (port 6380 in Docker, 6379 natively) |
| Docker     | 24+             | Container orchestration for workflow steps and stack services  |

Optional but strongly recommended:

- Docker Compose for running the full local stack
- A modern terminal with PowerShell 7+ (the lint summary script uses `pwsh`)

---

## Clone and Install

```bash
git clone https://github.com/imjimmeh/nexus-orchestator.git
cd nexus-orchestrator
npm install
```

`npm install` at the repo root installs all workspaces. `package-lock.json` at the repo root governs all workspace dependencies.

---

## Build Order

`packages/core` must be built first — every other workspace depends on its shared interfaces, enums, and schemas.

```bash
# 1. Build shared contracts
npm run build --workspace=packages/core

# 2. Build all apps (order matters for production builds)
npm run build:api
npm run build:kanban
npm run build:web
```

For iterative development, most `start:dev` commands use watch mode and will rebuild on change.

---

## Running the Stack

### Docker Compose (Recommended)

The full stack including Postgres, Redis, API, Kanban, and Web:

```bash
docker compose up -d --build
```

This starts all services on the Docker network `nexus-network` with health-checked startup ordering:

- Postgres and Redis start first
- API waits for Postgres and Redis health-checks
- Kanban waits for API health-check
- Web waits for both API and Kanban

With the Honcho memory backend profile:

```bash
docker compose --profile honcho up -d --build
```

Service startup cadence post-cutover — the API seeds LLM providers/credentials at boot. Set `SEED_LLM_SECRET_FROM_ENV=true` and supply `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` to auto-seed from environment variables.

### Individual Dev Servers (Native)

Useful when iterating on a single service. Start Postgres and Redis via Docker first:

```bash
docker compose up -d postgres redis
```

Then run the service(s) you need:

```bash
npm run start:api                          # NestJS --watch on port 3010
npm run start:dev --workspace=apps/kanban  # NestJS --watch on port 3012
npm run dev:web                            # Vite dev server on port 3120
```

When running services natively, ensure your `.env` points `DB_HOST`, `REDIS_HOST`, etc. to `localhost` with the correct external ports (5433 for Postgres, 6380 for Redis).

---

## Running Tests

### Unit & Integration Tests

```bash
npm run test:api                     # Vitest (apps/api)
npm run test:kanban                  # Vitest (apps/kanban)
npm run test:integration:kanban-core # Kanban integration suite
npm run test:unit:web                # Vitest (apps/web)
```

Target a single workspace with a pattern:

```bash
npm run test --workspace=apps/api
npm run test --workspace=apps/api -- -t "StepExecutionConsumer"
```

### E2E Tests

```bash
npm run test:e2e:web                      # Playwright (apps/web)
npm run test:e2e                          # Black-box API-side deterministic kanban E2E
npm run test:e2e:kanban:strict            # Kanban deterministic E2E (packages/e2e-tests)
npm run test:e2e:kanban:deterministic     # API-side deterministic kanban E2E
npm run test:e2e:review                   # Review E2E
```

E2E tests may require a running stack and proper `E2E_*` environment variables (see `.env.example`).

### Validation

```bash
npm run validate:seed-data   # Validates seed data integrity
```

---

## Linting and Typechecking

```bash
npm run lint            # Runs per-workspace; stops on first failure
npm run lint:api        # Lint only apps/api
npm run lint:web        # Lint only apps/web
npm run lint:kanban     # Lint only apps/kanban
npm run lint:summary    # PowerShell script — full repo visibility
```

Lint failure is fatal. Never suppress lint rules. Run lint before committing.

TypeScript compilation is verified as part of the `nest build` pipeline for NestJS apps and `tsc` for packages. Always run a build to catch type errors.

---

## Common Issues

### Docker Compose: API fails health-check or won't start

Check that Postgres and Redis are healthy first:

```bash
docker compose ps
```

If the API fails with TypeORM migration errors, the database may need re-creation:

```bash
docker compose down -v
docker compose up -d
```

### Docker host path remapping breaks workspace/tool mounts

Keep compose mounts and host env values (`NEXUS_HOST_WORKSPACE_PATH`, `NEXUS_HOST_SKILLS_PATH`, etc.) consistent. Mismatched paths cause container runtime errors when workflow steps attempt host-file access.

### Container images need rebuilding

Workflow steps run inside `nexus-light:latest` or `nexus-heavy:latest` containers. Rebuild them when Dockerfiles change:

```bash
docker build -f docker/Dockerfile.light -t nexus-light:latest .
docker build -f docker/Dockerfile.heavy -t nexus-heavy:latest .
```

### npm install failures in workspaces

Ensure you're running `npm install` from the repo root (not inside a workspace). The root `package-lock.json` governs all workspaces.

### Lint stops on first workspace failure

`npm run lint` exits on the first failing workspace. To see all failures across all workspaces at once:

```bash
npm run lint:summary
```

### Workflow containers fail fast without AI provider secrets

Workflow steps that use AI inference require provider credentials in the database (`secret_store`). Boot the stack with `SEED_LLM_SECRET_FROM_ENV=true` and valid API keys, or configure providers in the Web UI after startup.

---

## Where Next

- [01 — System Overview](01-system-overview.md): Tech stack, ports, monorepo layout, conventions
- [03 — Container Architecture](03-container-architecture.md): C4 Level 2 diagram and container detail
- [04 — Service Communication](04-service-communication.md): HTTP, WebSocket, queues, events, MCP/ACP
