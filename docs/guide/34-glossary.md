# 34 — Glossary

Alphabetical glossary of domain terms used throughout the Nexus Orchestrator. Each entry includes the term, its definition, the owning domain, and related terms. This glossary establishes the ubiquitous language across all services, packages, and documentation.

---

## A

### ACP (Agent Communication Protocol)

A protocol for agent-to-agent communication within the Nexus platform. ACP defines how agents discover each other, establish sessions, and exchange structured messages. Managed by the `AcpController` and ACP schemas in `@nexus/core`.

- **Domain**: Core API (`acp/` module)
- **Related**: MCP, Subagent, Mesh Delegation, War Room

### Agent Profile

A named configuration that defines how an AI agent behaves. Includes model selection, provider assignment, system prompt, allowed tools, assigned skills, and preference tiers. Stored in the `agent_profiles` table and seeded from `seed/agents/`.

- **Domain**: AI Config (`ai-config/` module)
- **Related**: Agent Skill, LLM Model, LLM Provider, Skill Assignment

### Agent Skill

A reusable capability module (Markdown instructions) that can be assigned to agent profiles. Skills define specialized knowledge and workflows. Seeded from `seed/skills/` and stored in the `agent_skills` table.

- **Domain**: AI Config (`ai-config/` module)
- **Related**: Agent Profile, Skill Assignment, Skill Validation

### AI Configuration Precedence

The 4-tier resolution order for determining which AI model/provider an agent uses at runtime:

1. **Workflow step override** — `steps[].inputs.model` / `provider` / `agent_profile` in the workflow YAML.
2. **Agent profile from DB** — The `agent_profiles` table.
3. **DB default model** — Default model configured per use case.
4. **Environment fallback** — `MODEL`, `DISTILLATION_MODEL`, `SUMMARIZATION_MODEL` env vars.

- **Domain**: AI Config
- **Related**: Agent Profile, LLM Model, LLM Provider, Workflow Step

### API/Kanban Boundary

The architectural separation between the Core API (workflow engine, chat, tools) and the Kanban domain service (projects, work items, orchestration). API/Core code must remain Kanban-neutral. Boundary violations are lint-enforced.

- **Domain**: Architecture
- **Related**: Core API, Kanban Service, Scope ID, Context ID

### Artifact

A file or data object produced by a workflow step and stored for later retrieval. Artifacts are managed by the `WorkflowRuntimeArtifactsController` and stored in workspace directories.

- **Domain**: Workflow Runtime
- **Related**: Workflow Run, Workflow Step, Host Mount

---

## B

### BullMQ

The job queue system used by the Nexus Orchestrator for asynchronous task processing. Built on Redis. Manages workflow step execution, chat session processing, distillation, cleanup, and scheduled jobs.

- **Domain**: Infrastructure (Redis module)
- **Related**: Redis, Queue, Workflow Step Execution, Scheduled Job

---

## C

### Capability

A unit of functionality that can be exposed by the system, a plugin, or an external MCP server. Capabilities include tools, hooks, and lifecycle handlers. Governed by the capability governance module.

- **Domain**: Capability Governance (`capability-governance/` module)
- **Related**: Tool, Capability Provider, Tool Approval Rule, Plugin Contribution

### Capability Governance

The policy framework controlling which agents can use which capabilities under what conditions. Implemented through tool approval rules, capability lifecycle validation, and tool call approval requests.

- **Domain**: Capability Governance
- **Related**: Tool Approval Rule, Tool Call Approval, Capability Provider

### Capability Provider

An entity that exposes one or more capabilities. Can be a built-in tool, a plugin, or an external MCP server. Registered in the capability registry.

- **Domain**: Capability Governance
- **Related**: Capability, Plugin, MCP, Tool Registry

### CEO Agent

The top-level orchestration agent responsible for high-level decision-making in Kanban project orchestration. Runs the project orchestration cycle, evaluates work item status, and dispatches work. Defined in `seed/agents/ceo-agent/`.

- **Domain**: Kanban (Orchestration)
- **Related**: Orchestration Cycle, Dispatch, Project, PM Hydration

### Chat Session

A conversation between a user and one or more AI agents. Chat sessions can originate from the Web UI, Telegram, or API. Processed asynchronously via the `chat-sessions` BullMQ queue.

- **Domain**: Chat (`chat/` module)
- **Related**: Chat Message, Chat Channel, Distillation, Telegram

### Concurrency Policy

A workflow-level configuration that controls how many instances of a workflow can run simultaneously. Prevents resource contention and enforces sequential execution when needed.

- **Domain**: Workflow Engine
- **Related**: Workflow, Workflow Run, DAG

### Container Orchestration

The system's ability to spawn, monitor, and clean up Docker containers for isolated workflow step execution. Managed by the Docker module (`dockerode` client).

- **Domain**: Docker / Workflow Execution
- **Related**: Execution Container, PI Runner, Workflow Step

### Credential Binding

A record in `harness_credential_binding` that maps a harness credential requirement (`credential_key`) to a `secret_store` secret at a `scope_node_id`. Scope-walk resolution: most-specific → ancestors → platform (`scope_node_id = NULL`).

- **Domain**: Harness
- **Related**: Harness, Device Flow, Secret Store

### Context ID (contextId)

A neutral identifier used in the Core API to reference a workflow's domain context without Kanban-specific semantics. In Kanban, this maps to a work item ID, but the Core API does not know that mapping.

- **Domain**: Core API (neutral boundary)
- **Related**: Scope ID, projectId (Kanban), workItemId (Kanban), API/Kanban Boundary

### Core API

The primary NestJS application (`apps/api/`) that serves as the orchestration engine. Manages workflows, chat sessions, tools, AI configuration, automation, plugins, MCP/ACP, and observability. Runs on port 3000 (host 3010).

- **Domain**: Architecture
- **Related**: Kanban Service, API/Kanban Boundary, Workflow Engine

---

## D

### DAG (Directed Acyclic Graph)

The execution graph of a workflow, where nodes are steps and edges are dependencies. The workflow engine topologically sorts the DAG to determine execution order. Steps with no inter-dependencies may run concurrently.

- **Domain**: Workflow Engine
- **Related**: Workflow, Workflow Step, Concurrency Policy, State Machine

### Dispatch

The process of assigning work items to available agents for execution. In the Kanban domain, dispatch evaluates work item priority, agent availability, and dependency constraints to determine the optimal assignment order.

- **Domain**: Kanban (Dispatch)
- **Related**: Orchestration Cycle, Work Item, Agent Profile, CEO Agent

### Device Flow

RFC 8628 OAuth 2.0 Device Authorization Grant. Initiated via `POST /api/harness/:harnessId/credentials/:key/device-flow`; completed by polling `GET .../device-flow/:deviceFlowId`. On completion, mints a `secret_store` secret and upserts a `harness_credential_binding`.

- **Domain**: Harness, Security
- **Related**: Credential Binding, OAuth

### Distillation

The process of summarizing and compressing long conversations into concise context for future agent turns. Runs asynchronously via the `distillation` BullMQ queue to keep chat sessions within model context window limits.

- **Domain**: Chat / Memory
- **Related**: Chat Session, BullMQ, Memory Backend

### Doctor Check

A diagnostic check that verifies the health and configuration of a subsystem. Part of the Operations Doctor framework. Checks include queue lag, dead letter inspection, Docker connectivity, split-service reachability, and seed data integrity.

- **Domain**: Operations (`operations/` module)
- **Related**: Operations Doctor, Heartbeat

### Domain Event

A significant occurrence within a bounded context that is published for other domains to react to. Carried via the event envelope format, published through NestJS EventEmitter, and persisted to the event ledger.

- **Domain**: Events (`events/` schemas)
- **Related**: Event Ledger, Event Trigger, Event Envelope, Lifecycle Event

---

## E

### Event Ledger

An append-only log of all significant events in the system. Implemented as the `event_ledger` database table. Used for observability, debugging, and audit trails. Queryable via `EventLedgerController`.

- **Domain**: Observability (`observability/` module)
- **Related**: Domain Event, Event Envelope, Telemetry Gateway

### Event Trigger

A workflow trigger that fires in response to a domain event. When a matching event is published, the workflow engine evaluates the trigger's conditions and launches a workflow run if satisfied.

- **Domain**: Workflow Engine
- **Related**: Workflow, Workflow Trigger, Domain Event, Event Ledger

### Execution Container

A Docker container spawned to run a single workflow step. The container runs the selected harness engine (e.g. the PI Runner when using the PI engine, or the Claude Code engine adapter), which creates an AI agent session, connects back to the API via WebSocket, and executes the step. Containers are cleaned up by `ContainerCleanupService`. See [41 — Harness Runtime](41-harness-runtime.md) for engine selection.

- **Domain**: Workflow Execution / Docker
- **Related**: Container Orchestration, PI Runner, Workflow Step, Docker

---

## H

### Heartbeat

A periodic signal sent by an automation hook or standing order to confirm it is still alive and functioning. Managed by `HeartbeatController`. Missing heartbeats can trigger repair or alert workflows.

- **Domain**: Automation (`automation/` module)
- **Related**: Standing Order, Scheduled Job, Doctor Check

### Harness

A runtime execution profile that pairs an engine implementation with capability declarations, credential requirements, and optional OAuth config. Built-in harnessIds: `pi` and `claude-code`. Custom harnessIds are prefixed `custom:*`.

- **Domain**: Harness Runtime
- **Related**: Harness Engine, Harness Engine SPI

### Harness Engine

A concrete implementation of the `HarnessEngine` SPI that runs inside or fronts an execution container. The two built-in engines are `@nexus/harness-engine-pi` and `@nexus/harness-engine-claude-code`.

- **Domain**: Harness Runtime
- **Related**: Harness, Harness Engine SPI

### Harness Engine SPI

The `HarnessEngine` TypeScript interface in `@nexus/harness-runtime` that defines `validate(config)`, `createSession(config, ctx)`, and `HarnessSession` lifecycle.

- **Domain**: Harness Runtime
- **Related**: Harness Engine

### Honcho

An optional external memory backend providing vector-based semantic search over conversation history. Available via the `--profile honcho` Docker Compose flag. Falls back to PostgreSQL-native memory when unavailable.

- **Domain**: Memory (`memory/` module)
- **Related**: Memory Backend, Distillation, Chat Session

### Host Mount

A filesystem directory on the Docker host that is mounted into an execution container. Enables agents to read/write project files, access shared workspaces, and use governed tool mounts. Configured via `NEXUS_HOST_*` environment variables.

- **Domain**: Workflow Execution / Docker
- **Related**: Execution Container, Worktree, Workspace, DinD

---

## I

### Internal Tool

A tool that is implemented within the Core API itself (not in an external service or plugin). Internal tools are handled by `WorkflowInternalToolsModule` and callbacks are routed through `WorkflowRuntimeInternalToolCallbacksController`.

- **Domain**: Tools (`tool/` module)
- **Related**: Tool, Tool Registry, Capability, Special Step Handler

---

## K

### Kanban Service

The NestJS application (`apps/kanban/`) that implements the Kanban domain. Manages projects, work items, orchestration cycles, reviews, retrospectives, and dispatch. Runs on port 3012. Separated from the Core API by the API/Kanban boundary.

- **Domain**: Kanban
- **Related**: Core API, API/Kanban Boundary, Project, Work Item, Orchestration Cycle

---

## L

### Lifecycle Event

A workflow lifecycle transition event, such as step start, step complete, run start, or run terminal. Published through the event system and persisted to the event ledger. Drives Kanban status transitions and telemetry updates.

- **Domain**: Workflow Engine
- **Related**: Domain Event, Event Ledger, Workflow Run, State Machine

### LLM Provider

A configured AI provider (e.g. OpenAI, Anthropic) stored in the `llm_providers` table. Each provider defines an `auth_type` (`api_key` or `oauth`), owner scoping (`owner_type`: `global`, `user`, or `scope`), and a `secret_id` reference to its credentials in `secret_store`.

**API-key providers** store a flat key map in the secret JSON. **OAuth providers** store a nested `oauth` token payload (`accessToken`, `refreshToken`, `expiresAt`, optional `scope`, `tokenType`). OAuth onboarding (authorization URL, token URL, client ID, client secret, scopes, redirect URI) is managed through the web UI provider page. The active harness engine (e.g. `@nexus/harness-engine-pi`) consumes resolved OAuth credentials delivered via the secure handshake and can refresh tokens — it does not initiate login.

- **Domain**: AI Config (`ai-config/` module)
- **Related**: LLM Model, Secret Vault, Agent Profile, Provider Reference, OAuth

---

## M

### MCP (Model Context Protocol)

An open protocol for exposing tools and resources to AI models. The Nexus Orchestrator can act as an MCP client (connecting to external MCP servers) and an MCP server (exposing its own tools). Managed by `McpController`.

- **Domain**: MCP (`mcp/` module)
- **Related**: ACP, Tool, Capability Provider, JSON-RPC

### Memory Backend

The storage system for agent conversation context. Supports two backends:

- **PostgreSQL** (default) — Stores conversation trees in relational tables.
- **Honcho** — Vector-based semantic memory with pgvector.

- **Domain**: Memory (`memory/` module)
- **Related**: Honcho, Distillation, Chat Session

### Mesh Delegation

A subagent coordination pattern where the primary agent delegates work items to a mesh of subagents. Includes capacity policy, governance, candidate querying, and delegation contract lifecycle.

- **Domain**: Subagents (`workflow-subagents/` module)
- **Related**: Subagent, Delegation Contract, Mesh Delegation Queue

### Module (NestJS)

A NestJS module that encapsulates a cohesive set of providers, controllers, and imports. The Core API comprises 56+ modules organized by domain. See [05-api-module-graph.md](05-api-module-graph.md) for the full module graph.

- **Domain**: Architecture (NestJS conventions)
- **Related**: Provider, Controller, Dependency Injection

---

## O

### Operations Doctor

A comprehensive diagnostic framework that runs system health checks. Includes queue lag monitoring, dead letter inspection, Docker health verification, split-service connectivity tests, and seed data validation. Accessible via `OperationsDoctorController`.

- **Domain**: Operations (`operations/` module)
- **Related**: Doctor Check, Heartbeat

### Orchestration Cycle

A recurring process in the Kanban domain that evaluates project state and makes orchestration decisions. The CEO agent reviews work items, assesses status, and triggers dispatch or refinement workflows. Managed by `OrchestrationController`.

- **Domain**: Kanban (Orchestration)
- **Related**: CEO Agent, Dispatch, Project, Work Item, PM Hydration

---

## P

### PI Runner

The PI harness engine (`@nexus/harness-engine-pi`) — one engine under the harness runtime. Implements `HarnessEngine` using `@earendil-works/pi-coding-agent`. See [41-harness-runtime.md](41-harness-runtime.md) and [28-pi-runner.md](28-pi-runner.md) for PI-specific internals.

- **Domain**: Runtime / Execution
- **Related**: Execution Container, Harness Engine, Harness Engine SPI

### Plugin

An extension that adds capabilities to the platform. Plugins declare their contributions (tools, hooks, UI) via a manifest, and the plugin kernel manages their lifecycle. Defined by `@nexus/plugin-sdk`.

- **Domain**: Plugin Kernel (`plugin-kernel/` module)
- **Related**: Plugin Contribution, Plugin Manifest, Capability Provider, Special Step Plugin

### Plugin Contribution

What a plugin provides to the platform: tools, lifecycle hooks, UI components, or special step handlers. Defined in `plugin-contribution.schema.ts` and registered at install time.

- **Domain**: Plugin Kernel
- **Related**: Plugin, Plugin Manifest, Capability, Special Step Handler

### Project

The top-level organizational unit in the Kanban domain. A project contains goals, work items, orchestration cycles, reviews, and dispatch configurations. Managed by `ProjectController`.

- **Domain**: Kanban
- **Related**: Work Item, Orchestration Cycle, Goal, Kanban Service

### Provider Reference

A structured reference that identifies which scoped provider a workflow step, agent profile, or runtime request should use. Supports two patterns:

1. **Exact provider ID**: `provider_id` selects one provider record without fallback.
2. **Separated source/name**: `provider_source` (`global`, `user`, or `scope`), `provider` name, and `model` name resolve within the current execution context.

`provider_id` wins if both are present. If `provider_source` is omitted, resolution uses execution context then falls back to global.

- **Domain**: AI Config
- **Related**: LLM Provider, Agent Profile, Workflow Step, Scoped Resource

---

## R

### Retrospective

A summary of a completed orchestration cycle or sprint in the Kanban domain. Captures what went well, what didn't, and suggested improvements. Managed by `RetrospectivesController`.

- **Domain**: Kanban
- **Related**: Orchestration Cycle, Project, Work Item

### Runtime Feedback

Structured feedback generated during agent execution. Can be submitted by agents, tools, or the system. Used for learning, skill improvement, and model evaluation. Managed by `RuntimeFeedbackController`.

- **Domain**: Memory / Learning
- **Related**: Learning, Skill Proposal, Agent Skill

---

## S

### Scheduled Job

A job that executes on a defined schedule (cron or interval). Managed by `ScheduledJobsController` and executed via the `scheduled-jobs` BullMQ queue. Used for periodic maintenance, recurring tasks, and standing order triggers.

- **Domain**: Automation (`automation/` module)
- **Related**: BullMQ, Standing Order, Heartbeat, Cron

### Scope ID (scopeId)

A neutral identifier used in the Core API to reference the broader context of a workflow run without Kanban-specific semantics. In Kanban, this maps to a project ID. The Core API must never use `projectId` directly.

- **Domain**: Core API (neutral boundary)
- **Related**: Context ID, projectId (Kanban), API/Kanban Boundary

### Scoped Default

A row in `scoped_ai_default` that sets preferred `harnessId`, `modelName`, and/or `providerName` for a given `scope_node_id` (`NULL` = platform). Resolved by `ScopedAiDefaultResolver` in the selection precedence chain between agent profile and platform default.

- **Domain**: Harness Runtime, AI Config
- **Related**: Selection Precedence

### Secret Vault

The encrypted storage for sensitive credentials (API keys, OAuth tokens). Implemented in the `secret_store` table with server-side encryption using `SECRET_ENCRYPTION_KEY`. Provider credentials reference secrets by `secret_id`.

API-key secrets store a flat key map (e.g. `{ "OPENAI_API_KEY": "..." }`). OAuth secrets store a nested payload under the `oauth` key with camelCase fields: `accessToken`, `refreshToken`, `expiresAt` (milliseconds since epoch), optional `scope`, and `tokenType`. Secrets are never returned in API responses — only metadata (name, created date) is exposed.

- **Domain**: Security / AI Config
- **Related**: LLM Provider, OAuth Onboarding, SECRET_ENCRYPTION_KEY

### Special Step Handler

A handler for workflow steps that require custom logic beyond standard agent execution. Special step types include workflow invocation, subagent spawning, and plugin-provided handlers. Defined via the `ISpecialStepHandler` interface.

- **Domain**: Workflow Engine (`workflow-special-steps/` module)
- **Related**: Workflow Step, Special Step Plugin, Internal Tool

### Standing Order

A persistent automation rule that triggers a workflow when specific conditions are met. Unlike scheduled jobs (time-based), standing orders react to state changes. Managed by `StandingOrdersController`.

- **Domain**: Automation (`automation/` module)
- **Related**: Scheduled Job, Heartbeat, Automation Hook, Event Trigger

### State Machine

The formal state model that governs workflow run and step transitions. Each state has defined entry criteria, valid transitions, and exit actions. Implemented in the workflow engine's lifecycle handlers.

- **Domain**: Workflow Engine
- **Related**: Workflow Run, Workflow Step, DAG, Lifecycle Event

### Step (Workflow)

A single unit of work within a workflow DAG. Each step has a job type (agent execution, special handler, subagent), inputs, dependencies, and a retry policy. Step execution is managed by `StepExecutionConsumer`.

- **Domain**: Workflow Engine
- **Related**: Workflow, DAG, Workflow Run, Special Step Handler

### Subagent

A secondary AI agent spawned by a primary agent to handle a subtask. Subagents run in their own execution containers with constrained capabilities. Managed by `WorkflowSubagentsModule` and the mesh delegation system.

- **Domain**: Subagents (`workflow-subagents/` module)
- **Related**: Mesh Delegation, Agent Profile, Execution Container, War Room

---

## T

### Transport

A `harness_definition` field with two values: `kernel` (engine runs in-container against an SDK) and `external` (engine fronts a remote HTTP endpoint).

- **Domain**: Harness Runtime
- **Related**: Harness

### Telemetry Gateway

The WebSocket gateway (`TelemetryGateway`) that receives real-time events from execution containers and broadcasts them to UI clients. Handles agent telemetry, tool execution events, step completion, and subagent coordination.

- **Domain**: Telemetry (`telemetry/` module)
- **Related**: WebSocket, Event Ledger, Notification Gateway, PI Runner

### Tool Mounting

The process of making tools available to an agent's execution context. Tools can be mounted from the built-in registry, plugins, or external MCP servers. Tool mounts are configured per step or per agent profile.

- **Domain**: Tools (`tool/` module)
- **Related**: Tool Registry, Capability, MCP, Execution Container

### Tool Policy

A DSL-based policy system that controls which tools an agent can call and under what conditions. Policies are parsed into ASTs and compiled into runtime predicate functions. Defined in `packages/core/src/tool-policy/`.

- **Domain**: Tools / Capability Governance
- **Related**: Capability Governance, Tool Approval Rule, Tool Registry

### Tool Registry

The central catalog of all available tools. Tools are registered by name with their input/output schemas, execution handlers, and capability metadata. Exposed via `ToolController`.

- **Domain**: Tools (`tool/` module)
- **Related**: Tool, Capability, MCP, Internal Tool, Tool Mounting

---

## W

### War Room

A multi-agent collaboration session where agents communicate via a shared blackboard to reach consensus. Supports participant invitations, message posting, blackboard updates, and sign-off workflows. Managed by `WorkflowRuntimeWarRoomController`.

- **Domain**: War Room (`war-room/` module)
- **Related**: Subagent, ACP, Blackboard, Mesh Delegation

### Web Automation

Browser-based automation using Playwright. Enables agents to navigate web pages, interact with elements, and extract data. Managed by `WebAutomationModule` and the PI Runner's browser runtime.

- **Domain**: Web Automation (`web-automation/` module)
- **Related**: PI Runner, Tool, Execution Container

### Work Item

The fundamental unit of work in the Kanban domain. Work items have a status (backlog → in-progress → in-review → ready-to-merge → done), priority, assignee, and dependencies. Managed by `WorkItemController`.

- **Domain**: Kanban
- **Related**: Project, Status State Machine, Dispatch, Orchestration Cycle

### Workflow

A defined sequence of steps (with a DAG structure) that accomplishes a specific goal. Workflows are authored in YAML, stored as `WorkflowDefinition` entities, and launched as `WorkflowRun` instances. See [11-workflow-catalog.md](11-workflow-catalog.md).

- **Domain**: Workflow Engine
- **Related**: Workflow Run, Workflow Step, DAG, Workflow Trigger, YAML

### Workflow Engine

The core subsystem that parses workflow YAML, manages workflow definitions, orchestrates runs, and evaluates the step DAG. Comprises the `WorkflowModule` and its 14 sub-modules.

- **Domain**: Workflow Engine
- **Related**: DAG, State Machine, Workflow, Workflow Run, Workflow Step

### Workflow Run

A single execution instance of a workflow. Tracks the state of each step, the overall run status, and all associated events. Managed by `WorkflowRunOperationsModule` and queryable via `WorkflowRunsController`.

- **Domain**: Workflow Engine
- **Related**: Workflow, Workflow Step, State Machine, Event Ledger

### Workflow Step

See [Step (Workflow)](#step-workflow).

### Workflow Trigger

A condition that causes a workflow to launch. Triggers can be event-based (domain events), schedule-based (cron), or manual (API call). Evaluated by the workflow engine before launching a run.

- **Domain**: Workflow Engine
- **Related**: Workflow, Event Trigger, Scheduled Job, Standing Order

### Worktree

A Git worktree created during a workflow run to provide an isolated working directory for the agent. Managed in the host workspace path and mounted into execution containers.

- **Domain**: Workflow Execution / Docker
- **Related**: Host Mount, Workspace, Execution Container, Git

---

## Boundary Terms

The API/Kanban boundary requires neutral terminology in Core API code. Here is the mapping:

| Core API (Neutral)         | Kanban Domain (Specific)      | Usage Rule                                                                            |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `scopeId` / `scope_id`     | `projectId` / `project_id`    | API/Core uses `scopeId` only. Kanban uses `projectId`.                                |
| `contextId` / `context_id` | `workItemId` / `work_item_id` | API/Core uses `contextId` only. Kanban uses `workItemId`.                             |
| `event type`               | Kanban lifecycle event        | API/Core publishes neutral events. Kanban maps them to status transitions.            |
| `tool call`                | Kanban MCP tool               | API/Core routes tool calls generically. Kanban owns Kanban-specific tool definitions. |

**Never** use Kanban identifiers (`projectId`, `workItemId`, `kanban`, `work-item`) in `apps/api/src` or `packages/core/src`. This boundary is lint-enforced.

---

## Ubiquitous Language Map

How the same concept is named across different domains:

| Concept            | Core API              | Kanban              | PI Runner      | User-Facing  |
| ------------------ | --------------------- | ------------------- | -------------- | ------------ |
| Unit of work       | Workflow Step         | Work Item           | Agent Turn     | Task         |
| Execution instance | Workflow Run          | Orchestration Cycle | Agent Session  | Job / Run    |
| Agent identity     | Agent Profile         | Agent Profile       | Agent Config   | AI Agent     |
| Tool authorization | Capability Governance | —                   | Tool Mounting  | Permissions  |
| Event recording    | Event Ledger          | Domain Events       | Telemetry      | Activity Log |
| State transitions  | State Machine         | Status Flow         | Session Phases | Progress     |
| Execution adapter  | Harness Engine        | —                   | —              | —            |
