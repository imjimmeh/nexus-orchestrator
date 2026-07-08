# Nexus Orchestrator

> **The open-source AI operations platform** — orchestrate autonomous agents, manage projects with AI-driven workflows, and ship multi-language code through a single control plane.

Nexus Orchestrator is a self-hosted platform for running AI agents at scale. It combines a DAG-based workflow engine, a Kanban project system with AI-driven orchestration cycles, multi-channel chat, and autonomous self-healing — all wrapped in a modern web UI. Every agent runs in an isolated Docker container, every step is observable, and every system is designed to keep running without babysitting.

---

## Why Nexus?

Most AI orchestration tools are either black-box SaaS or thin wrappers around a single LLM. Nexus is different — it's a **production-grade control plane** built for teams that need:

- **Deterministic, auditable workflows** — not a single prompt chain, but a full DAG of typed steps with branching, parallelism, retries, and state management
- **Multi-language agent execution** — Python, Go, Rust, Java, Node.js — each step picks its runtime, and Nexus builds a content-addressed container image on the fly
- **Project lifecycle automation** — a CEO-style orchestration cycle that reads the Kanban board, dispatches work to agents, requests code reviews, and runs retrospectives
- **Self-improving pipeline** — agents propose skill, agent-profile, workflow, and code changes through a governed improvement-proposal pipeline that reviews, applies, and can roll back its own changes
- **Any LLM, any provider** — swap OpenAI, Anthropic, or any OpenAI-compatible provider per-step or per-profile, with encrypted secret storage

---

## Features

### Workflow Engine

Declare multi-step jobs as YAML. The engine resolves dependencies, builds a DAG, parallelizes where it can, and executes each step in an isolated Docker container with the exact runtime it needs.

- **YAML-defined DAGs** — branching, parallelism, typed outputs, Handlebars templates, dependency wave scheduling
- **Container-isolated execution** — every step spins up a fresh Docker container with workspace mounts, tool access, and AI configuration
- **Durable agent await** — agents suspend on child workflows and resume in-context without holding a container open
- **Exact-point session resume** — two-phase mid-turn checkpointing recovers from the last durable snapshot, not the start
- **Subagent mesh** — provision child agents, delegate work, and orchestrate multi-agent teams
- **12 sub-modules** covering launch, repair, runtime tools, special steps (9 handlers), delegation, retrospection, and host mounts

### Multi-Language Runtimes

Why restrict agents to Node.js? Nexus detects the languages a step needs and builds a custom container image on demand.

- **5-layer toolchain resolution** — step override → agent profile → run input → repo detection → base default
- **Content-addressed composite images** — tagged `nexus-rt/<harnessId>:<12-hex>`, reused across runs, auto-GC'd after 7 days
- **Languages supported** — Python, Go, Rust, Java, Ruby, Deno, Bun, .NET, PHP (via `mise` version manager)
- **Cache volumes survive GC** — package caches and OS dependency caches persist between builds
- **Zero overhead for Node-only** — fast path skips composite build entirely

### Bring Your Own Harness

Nexus decouples the execution engine from the orchestrator. A step doesn't care _how_ an agent runs — only what toolchain it gets. The harness registry maps a harness type (e.g. `pi`, `claude-code`) to a Docker image and entrypoint contract.

- **Pluggable harness registry** — register new harnesses without touching workflow definitions or core engine code
- **Currently ships with PI Runner and Claude Code** — battle-tested execution engines for general-purpose and coding-agent workloads
- **BYOH for any agent** — implement the harness contract (container lifecycle, tool callbacks, output streaming) and plug in anything: a custom Python agent, a Go binary, a shell script runner, a proprietary SDK — any runtime that speaks the protocol
- **Side-by-side in the same DAG** — different steps in the same workflow can use different harnesses. A Claude Code step can delegate to a PI step, or vice versa
- **Backed by the same governance** — every harness goes through the same permission checks, tool resolution, telemetry pipeline, and retry policy

### Agent Local

A lightweight MCP-compatible service that runs on developer machines, giving agents governed access to local files, shell commands, and git operations without opening security holes.

- **MCP-compatible** — speaks standard Model Context Protocol; any MCP client can connect
- **Governed operations** — file read/write, command execution, git operations — all scoped to an allowlist
- **Local-first** — runs as a sidecar on the developer's machine, not in a container
- **Single-binary deployment** — no runtime dependencies beyond the target OS

### Kanban Project Service

A standalone domain service that drives project work through autonomous orchestration cycles. The "CEO agent" reads the board, assigns work, triggers reviews, and logs every decision.

- **CEO orchestration cycles** — automated iteration manager that evaluates board state, dispatches work items, and steers projects
- **Smart dispatch engine** — priority ordering, capacity calculation, target branch claims, orphan reconciliation
- **Automated code review** — triggers on review status transitions, records structured QA feedback
- **Retrospectives** — post-cycle analysis and learning, fed back into the next cycle
- **Board state service** — snapshots, mutation detection, column distribution analysis
- **MCP tool server** — exposes Kanban tools to agents with full audit trails
- **External sync** — pluggable providers for syncing to external project management systems

### Project Onboarding & Charter

Start a project by telling the CEO agent what you want. It elicits goals, constraints, and scope through a conversational setup flow, then generates a structured charter that drives the first orchestration cycle.

- **Conversational setup** — describe your project in natural language; the CEO agent asks clarifying questions and builds intent
- **Structured charter** — goals, milestones, acceptance criteria persisted as a first-class entity in the Kanban domain
- **Workspace bootstrapping** — creates the repo binding, initial work items, and automation hooks as part of onboarding
- **Full-stack from UI to memory** — charter flows from the web UI through the Kanban service into agent-accessible context

### Chat & Collaboration

Multi-channel persistent AI conversations that feed directly into the workflow engine.

- **Channel adapters** — Telegram (webhook + polling), WebSocket, REST API — extensible for more
- **Persistent memory** — PostgreSQL or Honcho backend with token counting, distillation, and a learning pipeline
- **Real-time streaming** — Socket.IO telemetry gateway for live agent output
- **Command-to-workflow** — chat messages bridge naturally to core workflow execution
- **Notifications** — outbound dispatch back to chat channels

### Automation & Scheduling

Every workflow can be scheduled, triggered by events, or set as a standing order.

- **Cron / interval / one-time** — scheduled execution with global and project scope
- **Event hooks** — trigger workflows on platform events (workflow status changes, work item transitions, cycle completions) with cooldowns and filters
- **Three action types** — invoke workflow, emit internal event, record metadata to work items
- **Heartbeat profiles** — configurable health-check patterns
- **Standing orders** — persistent recurring instruction execution

### Repository-Managed Workflows

Define workflows directly in your Git repo. Nexus discovers them on clone, wires them into the engine, and uses them as CI/CD gates for work items.

- **`.nexus/workflows/` convention** — drop YAML workflow definitions in your repo; Nexus auto-discovers and registers them
- **Per-repo CI/CD gates** — workflows run as blocking precheck hooks before work item transitions
- **Inherits full engine power** — repo workflows are first-class: DAGs, subagents, multi-language runtimes, all tooling — zero difference from UI-created workflows
- **Implicit environment** — repo workflows receive the checked-out code as their execution context automatically

### GitOps Repository Bindings

Sync Nexus configuration — workflows, agent profiles, skills, roles — to Git repositories for version-controlled, audit-trailed management.

- **Two sync modes** — `git-to-app` (repo is source of truth) or `two-way` (changes propagate in both directions)
- **Scope nodes** — bind specific entities (a workflow, a profile, a skill set) to files in a repo path
- **Push-based reconciliation** — Nexus webhooks listen for repo changes and apply them without downtime
- **Conflict detection** — drift between repo and DB state is flagged with clear resolution guidance

### AI Configuration

A 4-tier precedence system that gives you surgical control over which model runs where, with encrypted secret management.

- **4-tier resolution**: step YAML → agent profile → DB defaults → environment variables
- **Provider management** — OpenAI, Anthropic, any OpenAI-compatible — with encrypted `secret_store`
- **Agent profiles** — reusable personas with system prompts, model preferences, tool policies, and skills
- **Skills catalog** — assignable skill manifests with file listings
- **Thinking/effort levels** — per-model clamping with `off`-safe defaults
- **Memory token budgets** — model-aware 60/30/10 context window slicing

### Cost Governance & Budgeting

Every LLM call costs money. Nexus tracks spend at per-turn granularity, estimates costs against model-specific pricing, and lets you set policies that prevent bill shock — all from the web UI.

- **Per-turn cost tracking** — every agent turn is recorded as a usage event: input tokens, output tokens, model, provider, and estimated cost in cents
- **Model-specific pricing** — store per-million-token rates on each `llm_model` (`input_token_cents_per_million`, `output_token_cents_per_million`) for accurate estimation
- **Scoped policies** — create budget policies targeted at a global level, specific scope, context, workflow definition, agent profile, provider, or model
- **Four enforcement modes** — `observe` (log only), `warn`, `approval_required` (human gate), or `block` (deny execution outright)
- **Soft and hard limits** — soft limits trigger warnings or approval gates; hard limits always block when cumulative spend would exceed them
- **Multiple windows** — policies reset per-run, daily, weekly, monthly, or on a rolling window
- **Pre-flight evaluation** — check any action against all active policies before execution via the `/evaluate` endpoint
- **Spend dashboards** — web UI with KPI cards, spend timeline chart, pie chart by provider/model, top spenders, and a paginated event log
- **Work item cost visibility** — see per-work-item spend directly on the Kanban board
- **Budget context injection** — the agent's system prompt includes its remaining budget, so it can self-regulate expensive calls
- **Daily/weekly/monthly summaries** — aggregated spend timeline grouped by provider, model, scope, or context

### MCP Integration

Connect any MCP server for dynamic tool discovery and invocation — all through the same governance pipeline as built-in tools.

- **Dual transport** — HTTP/SSE and stdio (local process) with configurable timeouts and retries
- **Tool filtering** — include/exclude lists per server
- **Governance pipeline** — preflight capability checks, static permissions, dynamic approval, human-in-the-loop
- **Auto-reconnect** — periodic reconciliation keeps tools in sync across server restarts

### Tool System

A four-layer architecture that governs every tool an agent can call — from built-in utilities to external MCP servers — with consistent permission, routing, and telemetry.

- **Capability infrastructure** — tools declare what they need (filesystem, network, docker, etc.); the system checks availability before invocation
- **Tool registry** — central catalog of all tools: built-in, MCP-discovered, plugin-contributed, custom. Each with typed schemas, metadata, and ownership
- **Tool runtime** — invokes tools in-process or delegates to external processes, handles streaming responses and error wrapping
- **Tool governance** — every invocation runs through the same pipeline: capability check → static permission → dynamic approval → execution → audit log

### Tool Policy Engine

Fine-grained control over what agents can do, expressed as declarative policies with argument-aware rules.

- **ToolPolicyDocument model** — human-readable YAML policies that bind to tools, roles, or scopes
- **Argument-aware rules** — policies inspect tool arguments at runtime. Example: "allow `read_file` but only for paths matching `/workspace/*`"
- **Four effects** — `allow`, `deny`, `approval_required`, `guardrail` (sanitize arguments before execution)
- **Layered evaluation** — multiple policies merge with clear precedence; the most restrictive wins
- **Audit trail** — every policy evaluation is logged with the matched rule, effect, and arguments

### Plugin System

Extend the platform with trusted in-process plugins that contribute step handlers and capability endpoints.

- **Type-safe SDK** — `packages/plugin-sdk` with Zod schemas and `defineSpecialStepPlugin()` helper
- **Dynamic discovery** — scans configured directory at startup, validates manifests against a Zod schema
- **Registry isolation** — plugins cannot override reserved core step types
- **Manifest contract** — declared via `nexus.plugin.json`

### Self-Improvement Pipeline

A unified `improvement_proposals` pipeline lets agents propose and — subject
to governance — apply changes to the system that runs them.

- **Five proposal kinds** — `skill_create`, `skill_assignment`, `agent_profile_change`, `workflow_definition_change`, and `code_change`, each with a dedicated applier
- **Governed apply/rollback** — one governance policy gates auto-apply vs. human review, with rollback data captured for every applied proposal
- **Skill assignment** — bind an existing or newly-materialized skill to an agent profile or workflow/step via `workflow_skill_bindings`
- **Memory scope-targeting** — `remember` resolves `agent` / `workflow` / `project` / `global` scopes from run context instead of trusting raw agent-supplied ids
- **Code-change bridge** — approved engineering briefs become Kanban work items through a neutral lifecycle-stream event, with no direct API→Kanban dependency
- **Review queue UI** — web queue page with kind-specific diff/patch review and one-click rollback

### Telemetry & Observability

Every action in Nexus produces telemetry. An event ledger records workflow state changes, tool calls, agent decisions, and system events — all queryable in real time and storable for historical analysis.

- **Event ledger** — append-only log of every workflow lifecycle event, tool invocation, and system mutation with structured metadata
- **Distributed tracing** — OpenTelemetry instrumentation across the API, BullMQ queues, and container execution for end-to-end request visibility
- **Real-time streaming** — Socket.IO gateway pushes live state to the web UI and external subscribers
- **Audit history** — every user action, policy evaluation, and configuration change is recorded with identity and timestamp
- **Structured logging** — JSON-formatted logs with correlation IDs that trace a request across services, queues, and containers

### Operations Doctor

Built-in diagnostics that check every subsystem and optionally repair what they find.

- **8 health checks** — stuck workflows, queue lag, service health, container runtime, schema drift, tool/plugin registry, git worktrees, inter-service connectivity
- **Automated repair** — checks trigger `DoctorRepairExecutorService` for self-healing
- **Historical reporting** — all results stored for trend analysis and audit

### Web UI

A modern React management dashboard with live telemetry.

- **Kanban board** — drag-and-drop work item management with real-time state updates
- **Workflow editor** — create and visualise DAG pipelines
- **Live telemetry** — streaming agent output, run state, and system health
- **AI configuration** — manage providers, models, profiles, and secrets

---

## Architecture

```
┌─────────────────── Nexus Orchestrator ──────────────────────┐
│                                                              │
│  Web UI (React/Vite)   ←──REST/WS──→   Core API (NestJS)   │
│                                              │               │
│  Kanban Service (NestJS) ←──REST/Events──→  │               │
│                                              │               │
│  Execution Containers ←──Docker API── Core API              │
│       └── PI Runner / Claude Code harness                   │
│             └── Tool calls back to Core API (HTTP/WS)       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         │              │              │
    PostgreSQL        Redis         LLM Providers
                   (BullMQ queues)  (OpenAI, Anthropic…)
```

**Monorepo layout:**

```
apps/
  api/           NestJS orchestration engine — workflow DAG, tool system, AI config, telemetry
  kanban/        Kanban domain — projects, work items, orchestration policy, review lifecycle
  web/           Vite + React management UI — kanban board, workflow editor, live telemetry
packages/
  core/          Shared TypeScript interfaces, enums, schemas (build first)
  pi-runner/     Runtime bridge inside execution containers
  agent-local/   Local MCP-compatible service for governed file/command operations
  kanban-contracts/  Kanban domain contracts and MCP tool definitions
  plugin-sdk/    Plugin contribution schemas and types
  e2e-tests/     Black-box E2E and workflow integration suites
```

---

## Tech Stack

| Layer           | Technology                      |
| --------------- | ------------------------------- |
| Runtime         | Node.js 24+, TypeScript 5       |
| Backend         | NestJS 11, TypeORM              |
| Queue / pub-sub | BullMQ on Redis 7               |
| Database        | PostgreSQL 18+                  |
| Containers      | Docker (dockerode)              |
| Frontend        | React, Vite, Tailwind CSS       |
| Testing         | Vitest (unit), Playwright (E2E) |
| Protocols       | REST, WebSocket, MCP, ACP       |

---

## Getting Started

### Prerequisites

- Node.js 24+ and npm 10+
- Docker and Docker Compose
- PostgreSQL 15+ and Redis 7+ (or use the included Compose stack)

### Quickstart with Docker

The fastest path to a running stack:

```bash
git clone <repo>
cd nexus-orchestator

# Copy the example env file and customise it (host ports, DB password,
# JWT secret, LLM provider keys, ...). The compose file reads `${VAR:-default}`
# for every value, so `.env` only needs to override the variables you change.
cp .env.example .env

# Start all services (API, Kanban, Web UI, Postgres, Redis)
docker compose up -d --build
```

The compose stack exposes every value that varies between deployments as an
environment variable — host ports, container names, the Postgres user/password
shared by the API and Kanban, and the Honcho profile settings.
See [`.env.example`](.env.example) for the full list grouped by service
(Database, Redis, API, Web, Kanban, Honcho, Garage).

| Service       | URL / Address         |
| ------------- | --------------------- |
| Web UI        | http://localhost:3120 |
| Core API      | http://localhost:3010 |
| API WebSocket | http://localhost:3011 |
| Kanban API    | http://localhost:3012 |
| PostgreSQL    | localhost:5433        |
| Redis         | localhost:6380        |

### Local Development

```bash
npm install

# Build shared packages first — all apps depend on @nexus/core
npm run build --workspace=packages/core

# Start services in watch mode
npm run start:api          # Core API
npm run start:dev --workspace=apps/kanban
npm run dev:web            # Vite dev server
```

---

## Configuration

### AI Providers

Nexus requires at least one active LLM provider configured in the database to execute workflow steps. Use the Web UI provider management page or the admin API:

```
POST /api/ai-config/secrets    — store encrypted API keys or OAuth tokens
POST /api/ai-config/providers  — register a provider (linked to a secret)
POST /api/ai-config/models     — define models and set defaults
POST /api/ai-config/agent-profiles — create reusable agent personas
```

**Model resolution order** (most specific wins):

1. Workflow step override (`steps[].inputs.model` / `provider`)
2. Agent profile from the database
3. Default model for the use case (execution / distillation / summarization)
4. Environment variable fallback (`MODEL`, `DISTILLATION_MODEL`, `SUMMARIZATION_MODEL`)

### Memory Backend

| `MEMORY_BACKEND` value | Behavior                           |
| ---------------------- | ---------------------------------- |
| `postgres` (default)   | Conversation memory stored locally |
| `honcho`               | Read via Honcho adapter            |
| `dual`                 | Honcho primary, Postgres fallback  |

Enable the optional Honcho self-hosted memory service:

```bash
docker compose --profile honcho up -d
```

### Key Environment Variables

| Variable                 | Default                  | Description                          |
| ------------------------ | ------------------------ | ------------------------------------ |
| `DATABASE_URL`           | —                        | PostgreSQL connection string         |
| `REDIS_URL`              | —                        | Redis connection string              |
| `JWT_SECRET`             | —                        | JWT signing secret                   |
| `MEMORY_BACKEND`         | `postgres`               | Memory backend mode                  |
| `HONCHO_BASE_URL`        | `http://honcho-api:8000` | Honcho service URL (if using Honcho) |
| `NEXUS_HOST_SKILLS_PATH` | —                        | Host path for agent skill files      |

---

## Running Tests

```bash
npm run test:api              # Unit tests (Vitest)
npm run test:kanban           # Kanban unit tests
npm run test:unit:web         # Web unit tests
npm run test:e2e              # Black-box E2E against a live stack
npm run test:e2e:kanban:strict  # Deterministic Kanban E2E
```

Lint across all workspaces:

```bash
npm run lint:summary          # Full repo visibility (PowerShell)
```

---

## Documentation

The primary entry point is **[docs/guide/README.md](docs/guide/README.md)** — a unified guide with C4 architecture diagrams, domain deep-dives, and developer onboarding.

| Topic                        | Document                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| System overview & tech stack | [docs/guide/01-system-overview.md](docs/guide/01-system-overview.md)                       |
| Developer onboarding         | [docs/guide/02-getting-started.md](docs/guide/02-getting-started.md)                       |
| Workflow engine              | [docs/guide/06-workflow-engine.md](docs/guide/06-workflow-engine.md)                       |
| AI config (providers/models) | [docs/guide/12-ai-config.md](docs/guide/12-ai-config.md)                                   |
| Kanban domain                | [docs/guide/21-kanban-overview.md](docs/guide/21-kanban-overview.md)                       |
| Chat system                  | [docs/guide/13-chat-system.md](docs/guide/13-chat-system.md)                               |
| MCP integration              | [docs/architecture/mcp-integration.md](docs/architecture/mcp-integration.md)               |
| Automation & scheduling      | [docs/architecture/automation.md](docs/architecture/automation.md)                         |
| Multi-language runtimes      | [docs/guide/multi-language-runtimes.md](docs/guide/multi-language-runtimes.md)             |
| Cost governance & budgeting  | [docs/guide/37-cost-governance.md](docs/guide/37-cost-governance.md)                       |
| Tool system                  | [docs/guide/14-tool-system.md](docs/guide/14-tool-system.md)                               |
| Tool policies                | [docs/guide/36-tool-policy.md](docs/guide/36-tool-policy.md)                               |
| Telemetry & observability    | [docs/guide/18-telemetry-observability.md](docs/guide/18-telemetry-observability.md)       |
| Harness runtime              | [docs/guide/41-harness-runtime.md](docs/guide/41-harness-runtime.md)                       |
| Project onboarding           | [docs/guide/40-project-onboarding.md](docs/guide/40-project-onboarding.md)                 |
| Repository workflows         | [docs/guide/38-repository-workflows.md](docs/guide/38-repository-workflows.md)             |
| GitOps repository bindings   | [docs/guide/42-gitops-repository-bindings.md](docs/guide/42-gitops-repository-bindings.md) |
| Agent Local service          | [docs/guide/30-agent-local.md](docs/guide/30-agent-local.md)                               |
| Subagents                    | [docs/guide/09-workflow-subagents.md](docs/guide/09-workflow-subagents.md)                 |
| Self-improvement pipeline    | [docs/guide/48-improvement-pipeline.md](docs/guide/48-improvement-pipeline.md)             |
| Operations & diagnostics     | [docs/guide/20-operations.md](docs/guide/20-operations.md)                                 |
| Security                     | [docs/architecture/security.md](docs/architecture/security.md)                             |
| Plugin system                | [docs/architecture/plugin-system.md](docs/architecture/plugin-system.md)                   |
| Operations runbooks          | [docs/operations/](docs/operations/)                                                       |
| Architecture decisions       | [docs/adrs/](docs/adrs/)                                                                   |

## Inspirations/References/Shoutouts

- GitHub Actions for being the main inspiration for the workflow patterns.
- Vibe Kanban for the board-based project management system.
- Pi Coding Harness for being great.
