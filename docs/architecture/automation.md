# Automation and Scheduling Architecture

The Automation module provides time-based and event-driven automation capabilities across global and project scopes, including scheduled jobs, automation hooks, heartbeat profiles, and standing orders.

## Module Registration

`AutomationModule` is registered in `AppModule` and imports `DatabaseModule`, `SystemSettingsModule`, and `BullModule` (scheduled-jobs queue).

## Sub-Domains

### 1. Scheduled Jobs (EPIC-078)

Scheduled jobs execute workflows on a recurring or one-time basis.

Scheduled jobs can be:

- `project` scoped: bound to a specific project
- `global` scoped: not tied to any project

**Schedule types:**

| Type | Description |
|------|-------------|
| `cron` | Cron-expression based scheduling |
| `interval` | Fixed interval in seconds |
| `one_time` | Single future execution |

**Services:**

- `ScheduledJobsService` — CRUD and lifecycle management
- `ScheduledJobsRunnerService` — Evaluates due jobs and enqueues execution
- `ScheduledJobsPollingService` — Periodic scan for jobs whose `next_run_at` has passed
- `ScheduleExpressionService` — Validates and computes next run times from cron/interval expressions
- `ScheduledJobsConsumer` — BullMQ worker that executes the target workflow

**Entity: `scheduled_jobs`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `schedule_scope` | enum `ScheduledJobScope` | `project`, `global` |
| `project_id` | uuid nullable | Project scope when `schedule_scope = project` |
| `name` | varchar(180) | Human-readable name |
| `status` | enum `ScheduledJobStatus` | `active`, `paused` |
| `schedule_type` | enum `ScheduledJobType` | `one_time`, `interval`, `cron` |
| `schedule_expression` | text | Cron expression or interval value |
| `timezone` | varchar(128) | Optional timezone for cron |
| `next_run_at` | timestamptz | Next scheduled execution |
| `execution_target_type` | enum `ScheduledJobTargetType` | Currently `workflow` only |
| `execution_target_ref` | uuid | Workflow ID to execute |
| `payload_json` | jsonb | Workflow trigger payload |
| `paused_at` | timestamptz | When the job was paused |

**API routes:** `POST|GET|PATCH|DELETE /automation/schedules`, `POST /:id/pause`, `POST /:id/resume`, `POST /:id/run-now`, `GET /:id/runs`

`GET /automation/schedules` supports optional `scope`, `project_id`, and `status` filters.

### 2. Automation Hooks (EPIC-079)

Hooks bind actions to platform events with optional cooldown and filtering.

**Trigger types:**

| Trigger | Description |
|---------|-------------|
| `workflow.run.started` | Workflow run begins |
| `workflow.run.failed` | Workflow run fails |
| `work_item.status.changed` | Work item status transition |
| `project.orchestration.completed` | Orchestration cycle completes |

**Action types:**

| Action | Description |
|--------|-------------|
| `invoke_workflow` | Launch a workflow |
| `emit_event` | Emit a NestJS event |
| `record_metadata` | Write metadata to a work item |

**Entity: `automation_hooks`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `project_id` | uuid | Project scope |
| `enabled` | boolean | Active flag |
| `trigger_type` | enum `AutomationHookTriggerType` | Event binding |
| `trigger_filter` | jsonb | Optional filter criteria |
| `priority` | int | Execution order (default 100) |
| `action_type` | enum `AutomationHookActionType` | Action to perform |
| `action_payload` | jsonb | Action parameters |
| `cooldown_window_seconds` | int | Minimum seconds between fires |
| `last_fired_at` | timestamptz | Throttle tracking |

**API routes:** `POST|GET|PATCH|DELETE /automation/hooks`

### 3. Heartbeat Profiles (EPIC-079)

Heartbeats run periodic health-check workflows at fixed intervals.

**Entity: `heartbeat_profiles`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `project_id` | uuid | Project scope |
| `name` | varchar(180) | Human-readable name |
| `enabled` | boolean | Active flag |
| `interval_seconds` | int | Check frequency |
| `workflow_id` | uuid | Workflow to execute |
| `payload_json` | jsonb | Workflow trigger payload |
| `next_run_at` | timestamptz | Next scheduled check |
| `last_run_at` | timestamptz | Last completed check |

**Run entity: `heartbeat_runs`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `profile_id` | uuid | FK to heartbeat profile |
| `status` | enum `HeartbeatRunStatus` | `triggered`, `running`, `succeeded`, `failed`, `skipped`, `cancelled` |
| `workflow_run_id` | uuid | Associated workflow run |

**API routes:** `POST|GET|PATCH|DELETE /automation/heartbeat`, `POST /:id/run-now`, `GET /:id/runs`

### 4. Standing Orders (EPIC-079)

Standing orders are priority-ordered instruction policies that influence agent behavior during execution.

**Override policies:**

| Policy | Description |
|--------|-------------|
| `advisory` | Non-binding guidance, agents may deviate |
| `allow_override` | Agents can override with justification |
| `deny_override` | Strict enforcement, deviation not permitted |

**Entity: `standing_orders`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `project_id` | uuid | Project scope |
| `title` | varchar(180) | Order title |
| `instruction` | text | Full instruction text |
| `profile_name` | varchar(120) | Optional target agent profile |
| `enabled` | boolean | Active flag |
| `priority` | int | Execution order (default 100) |
| `override_policy` | enum `StandingOrderOverridePolicy` | `advisory`, `allow_override`, `deny_override` |

**API routes:** `POST|GET|PATCH|DELETE /automation/standing-orders`

## Event Listeners

- `ScheduledJobRunStatusListener` — Updates job run status on workflow events
- `HeartbeatRunStatusListener` — Updates heartbeat run status on workflow events
- `AutomationHooksListener` — Fires hooks when trigger events are emitted

## BullMQ Queues

- `scheduled-jobs` — Processes scheduled job executions

## UI Integration

Automation has both global and project-level entry points:

- global schedules page: `/schedules`
- project workspace schedules tab: `/projects/:projectId?tab=schedules`

## Related Docs

- docs/architecture/rest-api.md
- docs/architecture/workflow-engine.md
- docs/epics/EPIC-078-scheduled-jobs-and-cron-lifecycle.md
- docs/epics/EPIC-079-hooks-heartbeat-and-standing-orders.md
