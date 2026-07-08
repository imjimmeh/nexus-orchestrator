# Operations Doctor — Diagnostics and Auto-Repair (EPIC-082)

The Operations module provides a diagnostics framework (Doctor) that inspects platform health, detects anomalies, and executes safe repair actions.

## Module Registration

`OperationsModule` is registered in `AppModule`. It imports `DatabaseModule`, `DockerModule`, `WorkflowModule`, `ProjectModule`, `McpModule`, and registers multiple BullMQ queues for cross-module visibility.

## Architecture

### Core Services

| Service | Responsibility |
|---------|---------------|
| `DoctorReportService` | Generates consolidated diagnostic reports |
| `DoctorCheckRegistryService` | Registry of available integrity checks |
| `DoctorRepairExecutorService` | Executes safe repair actions with dry-run support |
| `DoctorHistoryService` | Persists and queries repair execution history |
| `WorkflowRecoveryCandidatesService` | Identifies workflow runs eligible for recovery |
| `RuntimeArtifactsInspectorService` | Inspects runtime containers, worktrees, and session artifacts |

### Integrity Checks

All checks implement the `IDoctorCheck` interface (`type` + `execute()`).

| Check | Description |
|-------|-------------|
| `WorkflowStuckStateCheck` | Detects workflow runs stuck in non-terminal states beyond expected duration |
| `QueueLagDeadLetterCheck` | Identifies BullMQ queue backpressure and dead-letter accumulation |
| `ContainerRuntimeIntegrityCheck` | Validates running containers against expected runtime state |
| `ContractSchemaMismatchCheck` | Detects drift between entity schemas and runtime contract expectations |
| `ToolPluginRegistryIntegrityCheck` | Verifies tool registry consistency and plugin mount integrity |

### Repair Execution Model

Repairs follow a safe-by-default execution model:

1. **Dry-run first**: Repairs can be executed in dry-run mode (`dry_run: true`) to preview effects without side effects.
2. **Evidence collection**: Each repair captures pre/post evidence in `evidence_json`.
3. **History tracking**: All repair attempts are persisted with status, timing, and outcome.
4. **Idempotency**: Repairs are keyed by `action_id` and can be safely retried.

**Entity: `doctor_repair_history`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `action_id` | varchar(120) | Identifies the repair action type |
| `status` | varchar(32) | `pending`, `running`, `succeeded`, `failed` |
| `dry_run` | boolean | Whether this was a dry-run |
| `requested_by` | varchar(255) | User or system that triggered the repair |
| `input_json` | jsonb | Repair input parameters |
| `result_json` | jsonb | Repair outcome details |
| `evidence_json` | jsonb | Pre/post evidence snapshots |
| `error_message` | text | Failure details |
| `started_at` | timestamptz | Execution start |
| `finished_at` | timestamptz | Execution completion |

## API Routes

All routes are under `@Controller('operations/doctor')` with
`@RequirePermission(...)` (the unified `PermissionsGuard` model). The
diagnostics and history reads require `settings:read`; the repair write
requires `settings:manage`. See [19 — Security § Unified Authorization
Guard](../guide/19-security.md#unified-authorization-guard) for the
guard/decorator contract.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/operations/doctor` | Generate a consolidated diagnostics report (permission: `settings:read`) |
| POST | `/operations/doctor/repair` | Execute a repair action, supports dry-run (permission: `settings:manage`) |
| GET | `/operations/doctor/history` | List repair execution history (permission: `settings:read`) |

### Diagnostics Report

`GET /operations/doctor` accepts optional query parameters:

- `checks` — Comma-separated list of check types to run (default: all)
- `verbose` — Include detailed evidence in the response

The report includes:

1. Overall health status
2. Per-check results with findings and severity
3. Recommended repair actions

### Repair Execution

`POST /operations/doctor/repair` accepts:

- `action_id` — The repair action to execute
- `dry_run` — Preview without side effects (default: false)
- `input` — Action-specific parameters

### History Query

`GET /operations/doctor/history` accepts:

- `action_id` — Filter by repair action type
- `status` — Filter by execution status
- `limit` — Maximum results (default: 50)

## Integration with Other Modules

The Operations module has visibility into:

- **WorkflowModule** — Stuck run detection and recovery
- **DockerModule** — Container runtime integrity
- **ProjectModule** — Orchestration state validation
- **McpModule** — MCP server connectivity checks

It monitors BullMQ queues: `workflow-steps`, `dispatch-polling`, and `scheduled-jobs`.

## UI Integration

Diagnostics are displayed inline within the project workspace **Orchestration tab** via `OrchestrationCapabilityHealthCard`. There is no standalone `/doctor` route.

## Related Docs

- docs/architecture/rest-api.md
- docs/operations/README.md
- docs/epics/EPIC-082-doctor-diagnostics-and-auto-repair.md
