# Workflow Seeding Guide

Workflows can be seeded in three ways:

## Option 0: Automatic Seeding on API Startup (Current Default)

On API startup, `StartupSeedService.seedOnStartup()` now runs workflow seeding in
addition to core role/provider/profile seeds. This keeps workflow YAML definitions
in sync in already-initialized environments.

**Why this matters:**

- New workflow YAML files (for example, post-merge hydration) are automatically
  created without re-running setup.
- Existing workflow YAML definition drift is auto-corrected on startup.
- Duplicate workflow rows for the same `workflow_id` are healed during seeding by
  keeping one active canonical row and deactivating the extras.

---

## Option 1: Automatic Seeding on First Admin Login (Recommended)

When the first admin user logs in and completes the setup flow (`POST /setup/initialize`), all workflows are automatically seeded into the database.

**How it works:**

1. First admin logs in → redirected to `/setup`
2. Admin fills out provider/secret/model configuration
3. Backend creates LLM provider, model, secret, and architect-agent
4. Backend automatically runs `seedWorkflows()` to populate all available workflow YAML files
5. Setup complete, admin can use the platform

**Workflow files seeded:**

- All `*.workflow.yaml` files under `apps/api/src/database/seeds/`
  (including default external lifecycle workflows)

**Implementation:** Integration in `SetupService.initialize()` method

---

## Option 2: Manual CLI Seeding

For development, testing, or manual workflow restoration, use the CLI script:

```bash
npm --prefix apps/api run seed:workflows
```

**Use cases:**

- Re-seed workflows in development environment
- Add workflows after initial setup
- CI/CD pipeline bootstrapping
- Recover workflows after database changes

**Requirements:**

- Environment variables for database connection:
  - `DB_HOST` (default: localhost)
  - `DB_PORT` (default: 5432)
  - `DB_USERNAME` (default: postgres)
  - `DB_PASSWORD` (default: postgres)
  - `DB_DATABASE` (default: nexus_dev)

**Output:**

```
[seed-workflows.cli] Connecting to database...
[seed-workflows.cli] Seeding workflows...
[seed-workflows.cli] Seeded workflow "Web Search Tool Test" from web-search-tool-test.workflow.yaml
[seed-workflows.cli] ✅ Workflow seeding complete
```

---

## Adding New Workflows

To add a new workflow to the seeding process:

1. Create a new YAML file in `apps/api/src/database/seeds/` with extension `.workflow.yaml`
2. Follow the workflow YAML schema (see example below)
3. Next time the setup runs or CLI seed is executed, your workflow will be included

### Workflow YAML Schema (V2)

```yaml
workflow_id: unique-workflow-id
name: Human Readable Name
description: What this workflow does

trigger:
  type: event | webhook | manual
  name: EventClassName # For event triggers
  event: external.resource.status_changed.v1 # For external status event triggers
  condition: "{{#if (eq trigger.status 'in-progress')}}true{{else}}false{{/if}}"
  description: When this triggers
  launch: # For manual triggers
    context: none | scope | context | resource
    inputs:
      - key: my_input
        type: string | number | boolean | json | string_array
        required: true

permissions:
  # Always use canonical runtime tool names.
  allow_tools:
    [read_file, write_file, bash, set_job_output, query_memory]
  deny_tools: []

jobs:
  # Agent-executed job (default when type is omitted)
  - id: step-1
    tier: light | heavy
    output_contract:
      required: [summary, status] # Required fields to be set via set_job_output
    depends_on: [other-step-id]
    inputs:
      agent_profile: profile-name
    steps:
      - id: default
        prompt: |
          Your agent instructions here.
          When finished, call set_job_output with your results.

  # Special step types (non-agent, automatic)
  - id: check-git
    type: run_command # Executes a shell command
    tier: light
    inputs:
      command: 'git status --porcelain'
      working_dir: worktree
    transitions:
      - condition: "jobs.check-git.output.stdout != ''"
        next: commit-step

  - id: notify-ready
    type: emit_event # Emits an application event
    tier: light
    inputs:
      event_name: WorkflowCheckpointReadyEvent
      payload:
        source: seed-example
        checkpoint: ready

  - id: merge-step
    type: git_operation # Attempts git merge or other git actions
    tier: light
    inputs:
      action: merge
    transitions:
      - condition: "jobs.merge-step.output.merge_outcome == 'succeeded'"
        next: finalize

  - id: invoke-step
    type: invoke_workflow # Invokes a child workflow
    tier: light
    workflow_id: child-workflow-id
    wait_for_completion: true

  - id: emit-event
    type: emit_event
    tier: light
    inputs:
      event_name: MyCustomEvent
      payload:
        data: '{{ jobs.step-1.output.summary }}'
```

### Supported Special Job Types

| Type                    | Domain | Description                                                                     |
| ----------------------- | ------ | ------------------------------------------------------------------------------- |
| `run_command`           | Core   | Executes a shell command (`sh -c`), outputs `{ ok, exit_code, stdout, stderr }` |
| `git_operation`         | Core   | Attempts git merge, worktree management, etc.                                   |
| `invoke_workflow`       | Core   | Spawns and optionally waits for a child workflow                                |
| `emit_event`            | Core   | Emits a system event to trigger downstream workflows                            |
| `register_tool`         | Core   | Registers a new tool in the tool registry                                       |
| `manage_tool_candidate` | Core   | Validates and publishes new tool artifacts                                      |
| `web_automation`        | Core   | Runs browser-based automation steps                                             |

---

## How Seeding Works

The seeding function:

1. Finds all `.workflow.yaml` files in the seeds directory
2. Extracts `workflow_id` and `name` from YAML
3. Upserts existing workflows by `workflow_id` (preferred) or by exact name
4. Updates changed YAML definitions and keeps workflows active
5. Deactivates duplicate rows for the same workflow identity
6. Logs all seeded workflows

**Idempotency:** Safe to run multiple times - performs upsert + duplicate cleanup.
