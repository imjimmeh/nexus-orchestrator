# 32 — Seed Data

How the Nexus Orchestrator bootstraps its database with initial data. Covers the startup seed lifecycle, what gets seeded, the workflow YAML pipeline, and how to add new seed data.

---

## Seed Data Architecture

Seed data populates the database with the minimum set of entities required for the system to function. Seeds run after TypeORM migrations on application startup and are **idempotent** — re-running seeds on an already-seeded database is safe.

GitOps repository bindings are the target source of truth for reusable platform configuration after bootstrap. Seeders still provide startup defaults and invariants, but global/default workflows, agent profiles, and skills can now be exported as first-class GitOps documents and reconciled from a platform configuration repository. See [42-gitops-repository-bindings.md](42-gitops-repository-bindings.md) and [gitops-seeding-migration.md](../operations/gitops-seeding-migration.md).

### Lifecycle

```
App Boot → TypeORM Migrations → StartupSeedService.seedOnStartup() → IAM Policy Refresh → Ready
```

Seed data lives in two locations:

| Location                       | Purpose                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `seed/` (repo root)            | Source-of-truth seed assets: YAML workflows, agent profile JSON, skill Markdown |
| `apps/api/src/database/seeds/` | Seed service logic: parsers, importers, validation                              |

### Idempotency

Each seed service checks whether the entity already exists before inserting. For example, workflows are indexed by their `name` field — if a workflow with that name already exists in the database, it is skipped. This means seeds can safely run on every startup.

---

## What Data Is Seeded

### Execution Order (StartupSeedService)

| Order | Seed Service                         | Entity               | What It Creates                                     |
| ----- | ------------------------------------ | -------------------- | --------------------------------------------------- |
| 1     | `RoleSeedService`                    | `Role`               | Default roles (admin, user, agent)                  |
| 2     | `SetupConfigSeedService`             | `SetupConfig`        | System setup configuration (completed/skipped flag) |
| 3     | `LlmSecretSeedService`               | `LlmSecret`          | Encrypted API keys for LLM providers                |
| 4     | `LlmProviderSeedService`             | `LlmProvider`        | LLM provider definitions (OpenAI, Anthropic, etc.)  |
| 5     | `LlmModelSeedService`                | `LlmModel`           | Model definitions linked to providers               |
| 6     | `SkillSeedService`                   | `AgentSkill`         | Agent skills from the skill library                 |
| 7     | `AgentProfileSeedService`            | `AgentProfile`       | Agent profiles with model/provider assignments      |
| 8     | `AgentSkillAssignmentsSeedService`   | (join table)         | Many-to-many skill ↔ profile assignments            |
| 9     | `ToolApprovalRulesSeedService`       | `ToolApprovalRule`   | Default tool approval rules                         |
| 10    | `WorkflowSeedService`                | `WorkflowDefinition` | Workflow definitions from YAML files                |
| 11    | `IAMPolicyService.refreshPolicies()` | (in-memory)          | Refreshes IAM policy cache                          |

The order matters: providers must exist before models, models before profiles, skills before skill assignments.

---

## Workflow YAML to DB Entity Pipeline

### Source Files

Workflow definitions are authored as YAML files in `seed/workflows/` with the `.workflow.yaml` extension. Example:

```
seed/workflows/
├── standard-feature-flow.workflow.yaml
├── hotfix-flow.workflow.yaml
├── work-item-in-progress-default.workflow.yaml
├── work-item-in-review-default.workflow.yaml
├── work-item-ready-to-merge-default.workflow.yaml
├── project-orchestration-cycle-ceo.workflow.yaml
├── workflow-failure-doctor.workflow.yaml
├── chat-direct-agent-default.workflow.yaml
├── conversational-artifact-steering.workflow.yaml
├── automated-quality-check.workflow.yaml
└── ... (29 total)
```

### Pipeline Steps

1. **File Discovery**: `WorkflowSeedService` scans `seed/workflows/` (path configurable via `NEXUS_WORKFLOWS_SEED_PATH`).
2. **Parsing**: Each `.workflow.yaml` file is parsed using the workflow YAML parser into a structured `WorkflowDefinition` object.
3. **Validation**: Parsed definitions are validated against the workflow schema.
4. **Deduplication**: The service checks if a workflow with the same `name` already exists in the database.
5. **Insert/Update**: New workflows are inserted; existing ones can be updated if the seed data has changed.

### Workflow Name Convention

Workflow seed names are derived from the YAML `name` field. Name collisions between seed files are detected and reported as errors.

---

## Agent Profiles

### Source Format

Each agent profile is a directory under `seed/agents/<agent-name>/` containing:

```
seed/agents/software-engineer-assistant/
├── agent.json       # Profile metadata
└── PROMPT.md        # System prompt content
```

### `agent.json` Structure

```json
{
  "name": "software-engineer-assistant",
  "tier_preference": 1,
  "allowed_tools": ["read", "write", "edit", "bash"],
  "assigned_skills": ["code-review", "refactoring"],
  "model_name": "MiniMax-M3",
  "provider_name": "minimax",
  "is_active": true
}
```

| Field             | Required | Description                                              |
| ----------------- | -------- | -------------------------------------------------------- |
| `name`            | Yes      | Unique profile name (used as DB primary key)             |
| `tier_preference` | No       | Preference tier for model selection (1 = highest)        |
| `allowed_tools`   | No       | List of tool names this agent is permitted to use        |
| `assigned_skills` | No       | Skill names assigned to this profile                     |
| `model_name`      | No       | Default model override                                   |
| `provider_name`   | No       | Default provider override                                |
| `is_active`       | No       | Whether the profile is available for use (default: true) |

### Seeded Agent Profiles

19 agent profiles are seeded by default:

| Profile                             | Role                                           |
| ----------------------------------- | ---------------------------------------------- |
| `software-engineer-assistant`       | General development agent                      |
| `senior_dev`                        | Senior developer with code review capabilities |
| `junior_dev`                        | Junior developer with limited scope            |
| `architect-agent`                   | System architecture and design                 |
| `product-manager`                   | Project management and prioritization          |
| `spec-generator`                    | Specification and PRD generation               |
| `ceo-agent`                         | Top-level orchestration and decision-making    |
| `orchestrator`                      | Orchestration cycle coordinator                |
| `staff_engineer`                    | Technical leadership and mentoring             |
| `qa_automation`                     | Automated quality assurance and testing        |
| `sysadmin-repair`                   | System repair and recovery                     |
| `friendly-general-assistant`        | General-purpose chat agent (Telegram default)  |
| `investigation-subagent`            | Deep-dive investigation worker                 |
| `investigation-coordinator`         | Investigation task coordinator                 |
| `testing-agent`                     | E2E testing agent                              |
| `research-and-automation-assistant` | Research tasks and automation scripting        |
| `acp-command-executor`              | ACP command execution agent                    |
| —                                   | _(remaining profiles)_                         |

### Skill Assignments

Two paths exist for skill assignment:

1. **Folder-based** (preferred): `assigned_skills` in each `agent.json`.
2. **Legacy**: `seed/agents/skill-assignments.seed.json` — a standalone mapping file. This is only used if folder-based seeds omit `assigned_skills`, and logs a deprecation warning.

---

## LLM Providers and Models

### Default Providers

Seeded by `LlmProviderSeedService`. Each provider record includes:

- Provider name (e.g., `openai`, `anthropic`, `minimax`)
- Base URL for the provider API
- Reference to a secret (`secret_id`) for the API key

### Default Models

Seeded by `LlmModelSeedService`. Each model record includes:

- Model name (e.g., `gpt-4.1`, `claude-sonnet-4-20250514`, `MiniMax-M3`)
- Provider reference
- Context window size
- Input/output token costs
- Capabilities (vision, tool-use, structured-output)

Models are linked to providers via foreign key. A model cannot be seeded before its provider exists.

### Secrets

API keys are stored encrypted in the `secret_store` table, seeded by `LlmSecretSeedService`. In development, secrets can be bootstrapped from environment variables by setting `SEED_LLM_SECRET_FROM_ENV=true`.

---

## Agent Skills

### Source Format

Skills are Markdown files organized by name in `seed/skills/`:

```
seed/skills/
├── code-review/
│   └── SKILL.md
├── refactoring/
│   └── SKILL.md
├── testing-unit-patterns/
│   └── SKILL.md
└── ...
```

Each skill has:

- A folder name that becomes the skill name
- A `SKILL.md` file with the skill's instructions
- Optional resource files within the folder

### Seeding Process

`SkillSeedService.seed()` (synchronous):

1. Scans the skills directory (configurable via `NEXUS_SKILLS_SEED_PATH`).
2. Imports each skill into the runtime skills library (at `NEXUS_SKILLS_LIBRARY_PATH`).
3. Creates `AgentSkill` database entities for each imported skill.
4. Runs skill validation: checks for dependencies, circular references, and schema compliance.

### Skill Validation

`SkillValidationService` ensures:

- Skill names are unique.
- Referenced dependencies exist.
- No circular dependency chains.
- Skill content is parsable.

---

## Seed Contracts and Validation

### Kanban Seed Contracts

`apps/kanban/src/seeds/` contains validation specs that verify Kanban-specific seed data:

- Workflow seeds must produce valid Kanban triggers
- Event payloads must match Kanban event schemas
- Status transitions in seeded workflows must align with Kanban lifecycle

### Seed Data Validation Suite

The `seed-data-validation.*.ts` files in `apps/api/src/database/seeds/` provide:

- **Contract Compiler**: Validates that seed workflow YAML produces valid DB entities.
- **Prompt Validation**: Checks that agent profile system prompts are coherent and reference valid skills/tools.
- **Tool Discovery**: Validates that tools referenced in seed data exist in the tool registry.
- **Policy Checks**: Ensures seeded tool approval rules are well-formed.
- **Effective Access**: Validates that agent profiles have correct tool access given their seed configuration.

Run with:

```bash
npm run validate:seed-data
```

---

## How to Add New Seed Data

### Adding a New Workflow

1. Create a YAML file in `seed/workflows/` with the `.workflow.yaml` extension.
2. Define the workflow with a unique `name`, `steps`, `triggers`, and `conditions`.
3. Use the workflow YAML authoring conventions (see [11-workflow-catalog.md](11-workflow-catalog.md)).
4. The workflow will be automatically picked up by `WorkflowSeedService` on next startup.
5. Verify with `npm run validate:seed-data`.

### Adding a New Agent Profile

1. Create a directory under `seed/agents/<profile-name>/`.
2. Add `agent.json` with the required fields (`name` at minimum).
3. Add `PROMPT.md` with the system prompt content.
4. The profile will be seeded by `AgentProfileSeedService` on next startup.

### Adding a New Skill

1. Create a directory under `seed/skills/<skill-name>/`.
2. Add `SKILL.md` with the skill instructions.
3. Optionally add resource files within the directory.
4. Reference the skill name in agent profile `assigned_skills` to assign it.
5. The skill will be imported by `SkillSeedService` on next startup.

### Adding a New LLM Provider/Model

Modify the seed service implementations in `apps/api/src/database/seeds/agent/`:

- `llm-providers.seed.ts` — Add provider records.
- `llm-models.seed.ts` — Add model records linked to providers.

---

## Seeding in Development vs Production

### Development

- Full seed spectrum: all profiles, skills, workflows, providers, and models.
- Secrets may be bootstrapped from `.env` (`SEED_LLM_SECRET_FROM_ENV=true`).
- Seed paths default to `./seed/` (mounted read-only in Docker).
- Workflow dry-run mode is enabled (`WORKFLOW_DRY_RUN=true` in `.env.example`).

### Production

- Seeds are idempotent — safe to run on every deploy.
- Secrets should NOT be bootstrapped from environment variables. Use the secret store UI or API instead.
- Keep seeders enabled until the environment has a healthy platform GitOps binding.
- Manage reusable workflows, agent profiles, and skills through GitOps repository bindings once migrated.
- Set `SEED_LLM_SECRET_FROM_ENV=false` (the default).
- Seed paths can be overridden via environment variables (`NEXUS_WORKFLOWS_SEED_PATH`, etc.).

### Environment Variables for Seed Control

| Variable                                  | Default                                     | Purpose                                                          |
| ----------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `NEXUS_SKILLS_SEED_PATH`                  | `./seed/skills`                             | Skills source directory                                          |
| `NEXUS_AGENTS_SEED_PATH`                  | `./seed/agents`                             | Agent profile source directory                                   |
| `NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH` | `./seed/agents/skill-assignments.seed.json` | Legacy skill assignments file                                    |
| `NEXUS_WORKFLOWS_SEED_PATH`               | `./seed/workflows`                          | Workflow YAML source directory                                   |
| `SEED_LLM_SECRET_FROM_ENV`                | `false`                                     | Bootstrap secrets from `E2E_PROVIDER_API_KEY` / `OPENAI_API_KEY` |
| `STRICT_SKILL_VALIDATION`                 | `false`                                     | Enable strict validation for skill dependencies                  |
