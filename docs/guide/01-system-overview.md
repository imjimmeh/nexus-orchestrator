# 01 — System Overview

A high-level roadmap of the Nexus Orchestrator: its tech stack, monorepo layout, ports, how to run it, and the architectural conventions that govern all development.

---

## Tech Stack

| Layer              | Technology                        | Version |
| ------------------ | --------------------------------- | ------- |
| Runtime            | Node.js                           | 24+     |
| Package manager    | npm                               | 10+     |
| Language           | TypeScript                        | 5.x+    |
| Backend framework  | NestJS                            | 11+     |
| API style          | REST + WebSocket                  | —       |
| ORM                | TypeORM                           | —       |
| Message queue      | BullMQ (on Redis)                 | —       |
| Database           | PostgreSQL                        | 18+     |
| Cache / pub-sub    | Redis                             | 7+      |
| Container runtime  | Docker (dockerode)                | —       |
| AI agent SDK       | `@earendil-works/pi-coding-agent` | —       |
| Frontend framework | React + Vite                      | —       |
| CSS                | Tailwind CSS                      | —       |
| Testing (unit)     | Vitest                            | —       |
| Testing (e2e)      | Playwright + Vitest               | —       |
| Linting            | ESLint                            | —       |
| Monorepo tooling   | npm workspaces                    | —       |

---

## Monorepo Layout

```
nexus-orchestrator/
├── apps/                        # Deployable services
│   ├── api/                     # NestJS core orchestration engine
│   ├── kanban/                  # NestJS kanban domain service
│   ├── web/                     # Vite + React + Tailwind management UI
│   └── chat/                    # Chat channel ingestion (planned, not yet implemented)
├── packages/                    # Shared libraries
│   ├── core/                    # Shared TS interfaces, enums, schemas (build this first)
│   ├── shared/                  # Shared utilities
│   ├── pi-runner/               # Runtime bridge for execution containers
│   ├── agent-local/             # Local MCP-compatible service for governed operations
│   ├── e2e-tests/               # Black-box E2E and workflow integration suites
│   ├── kanban-contracts/        # Kanban domain contracts
│   └── plugin-sdk/              # Plugin SDK schemas
├── docker/                      # Container image Dockerfiles (light/heavy)
├── docs/                        # Project documentation
├── seed/                        # Seed data (workflows, agent profiles, skills)
├── .agents/skills/              # Agent skill definitions
└── docker-compose.yaml          # Local stack definition
```

Key rule: `apps/` = deployable services, `packages/` = shared libraries. Shared contracts live in `@nexus/core` and must never be redefined locally. All imports use absolute paths configured in the workspace `tsconfig.json`.

---

## Service Ports

| Service       | Internal Port | External Port | Notes                        |
| ------------- | ------------- | ------------- | ---------------------------- |
| API HTTP      | 3000          | 3010          | NestJS REST endpoints        |
| API WebSocket | 3001          | 3011          | Socket.IO telemetry gateway  |
| Kanban API    | 3012          | 3012          | Kanban domain REST endpoints |
| Web UI        | 80            | 3120          | Nginx-served React SPA       |
| PostgreSQL    | 5432          | 5433          | Primary data store           |
| Redis         | 6379          | 6380          | Queues, pub-sub, caching     |
| Agent Local   | 3033          | 3033          | Local MCP service            |
| Honcho API    | 8000          | 8030          | Honcho profile only          |
| Honcho DB     | 5432          | 5443          | Honcho profile only          |

Internal ports are used inside the Docker network (`nexus-network`); external ports are mapped to the host.

---

## How to Run Locally

### Full Stack (Docker Compose)

```bash
# Start the core stack (Postgres, Redis, API, Kanban, Web)
docker compose up -d --build

# Start with Honcho memory backend (adds honcho-db, honcho-api, honcho-deriver)
docker compose --profile honcho up -d --build
```

The API health-check waits for Postgres and Redis to be ready; Kanban waits for API; Web waits for both API and Kanban.

### Individual Dev Servers (Outside Docker)

You can run each service natively while pointing at the Docker-hosted Postgres and Redis. Build `packages/core` first — all apps depend on it.

```bash
npm run build --workspace=packages/core
npm run start:api
npm run start:dev --workspace=apps/kanban
npm run dev:web
```

---

## Key Environment Variables

| Variable                                               | Purpose                                      | Default                                     |
| ------------------------------------------------------ | -------------------------------------------- | ------------------------------------------- |
| `DB_HOST` / `DB_PORT` / `DB_DATABASE`                  | PostgreSQL connection                        | `localhost` / `5432` / `nexus_orchestrator` |
| `REDIS_HOST` / `REDIS_PORT`                            | Redis connection                             | `localhost` / `6379`                        |
| `JWT_SECRET`                                           | JWT signing key (min 32 chars in production) | `nexus-secret-key`                          |
| `SECRET_ENCRYPTION_KEY`                                | Encryption key for `secret_store`            | —                                           |
| `MODEL` / `DISTILLATION_MODEL` / `SUMMARIZATION_MODEL` | AI model fallbacks                           | —                                           |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`                 | Provider credential fallbacks                | —                                           |
| `DOCKER_SOCKET_PATH` / `DOCKER_HOST`                   | Docker daemon access                         | `/var/run/docker.sock`                      |
| `TELEMETRY_PUBLIC_WS_URL`                              | Public WebSocket URL returned to clients     | `http://localhost:3011`                     |
| `MEMORY_BACKEND`                                       | Memory storage backend                       | `postgres`                                  |
| `CORS_ORIGIN`                                          | Allowed CORS origin                          | `*`                                         |
| `NEXUS_SKILLS_SEED_PATH`                               | Seed skills directory                        | `./seed/skills`                             |
| `NEXUS_WORKFLOWS_SEED_PATH`                            | Seed workflows directory                     | `./seed/workflows`                          |

See `.env.example` for the full list of available variables.

---

## Core Development Conventions

### Strict Lint Policy

Never suppress linting (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, rule downgrades). Fix findings in code. If blocked, escalate with the rule name, file, and compliant alternatives.

`npm run lint` stops on the first failing workspace. Use `npm run lint:summary` for repo-wide visibility.

### API Quality Gate

Controllers handle transport only. Services own domain logic. Repositories own persistence. This separation is enforced across all NestJS modules.

### Web Quality Gate

React components are presentation-focused. Side effects (data fetching, state management, WebSocket subscriptions) go into hooks and services.

### NestJS Conventions

- Use `nest build` (not `tsc`) — it handles TypeORM reflection and NestJS-specific output.
- Tests rely on SWC decorator metadata. Keep Vitest/SWC config aligned.
- Enforce strong typing. Shared interfaces live in `packages/core`.

---

## Architecture Boundaries

### API / Kanban Boundary

`apps/api/src` and `packages/core/src` must remain Kanban-neutral. Never use `kanban`, work-item, or project-domain identifiers in API/core code, tests, migrations, fixtures, comments, or seed contracts.

API/core workflow context uses neutral `scopeId` / `scope_id` and `contextId` / `context_id` fields only. Kanban lifecycle validation, event payload shape, status names, and work-item projections belong in `apps/kanban`, `packages/kanban-contracts`, or `packages/kanban-mcp`.

Boundary enforcement is lint-driven by `nexus-boundaries/no-core-kanban-residue`. Workflows needing Kanban behavior must call Kanban-owned endpoints from the Kanban side.

### AI Config Precedence

At runtime, AI model and provider selection follows this order (always checked in sequence):

1. Workflow step override (`steps[].inputs.model` / `provider` / `agent_profile`)
2. Agent profile from the database (`agent_profiles`)
3. Database default model for the use case
4. Environment fallback (`MODEL`, `DISTILLATION_MODEL`, `SUMMARIZATION_MODEL`)

Provider credentials are stored in `secret_store` (encrypted server-side) and referenced by `llm_providers.secret_id`. Workflow containers enforce real AI execution — they fail fast without DB-configured provider secrets.

### Workflow Module Boundaries

When adding workflow-adjacent functionality, use the narrowest existing module boundary.

| Module                        | Path                                | Responsibility                                                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `WorkflowModule`              | `workflow/`                         | Core engine: parsing, validation, persistence, state, DAG, event log, triggers |
| `WorkflowLaunchModule`        | `workflow/workflow-launch/`         | Launch API, contracts, orchestration helpers                                   |
| `WorkflowRunOperationsModule` | `workflow/workflow-run-operations/` | Run-facing API, steering, reconciliation, idle tracking                        |
| `WorkflowSpecialStepsModule`  | `workflow/workflow-special-steps/`  | Special step registry, executor, handlers                                      |
| `WorkflowSubagentsModule`     | `workflow/workflow-subagents/`      | Subagent provisioning, lifecycle, communication mesh                           |
| `WorkflowStepExecutionModule` | `workflow/workflow-step-execution/` | Step queue consumer, container execution, retry policy                         |
| `WorkflowHostMountModule`     | `workflow/workflow-host-mount/`     | Host mount resolution, audit, startup validation                               |
| `WorkflowPublishSpecsModule`  | `workflow/workflow-publish-specs/`  | Publish-specs parser, pure helpers                                             |
| `WorkflowRuntimeModule`       | `workflow/workflow-runtime/`        | Agent-facing runtime capabilities, formatting/contracts                        |
| `WorkflowRepairModule`        | `workflow/workflow-repair/`         | Failure classification, repair policy, dispatch                                |
| `WorkflowInternalToolsModule` | `workflow/workflow-internal-tools/` | Internal tool adapters and handler services                                    |
| `WebAutomationModule`         | `web-automation/`                   | Playwright driver, browser sessions, selectors                                 |
| `WarRoomModule`               | `war-room/`                         | Multi-agent war-room sessions, blackboard, consensus                           |

---

## Where Next

- [02 — Getting Started](02-getting-started.md): Developer onboarding, build, test, debug
- [03 — Container Architecture](03-container-architecture.md): C4 Level 2 diagram and container detail
- [04 — Service Communication](04-service-communication.md): HTTP, WebSocket, queues, events, MCP/ACP
