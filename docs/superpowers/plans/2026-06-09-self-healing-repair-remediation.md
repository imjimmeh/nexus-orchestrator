# Self-Healing & Repair Automation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore end-to-end automated self-healing — the in-process doctor/repair pipeline (Pipeline B) and the standalone repair-agent (Pipeline A) — which has been inert since the Kanban code was split into `apps/kanban`.

**Architecture:** Two pipelines were broken by the Kanban cutover (commit `c84d7ed6`) and pre-existing gaps. Pipeline B (NestJS, in `apps/api`) re-acquires (A) a **scope-agnostic** failure-doctor trigger implemented as a direct event listener — DB automation hooks can't be scope-agnostic because their `scope_id` is non-nullable and `AutomationHooksListener` bails without a `scopeId`; (B) the **missing sysadmin repair request listener**; (C) the repair-delegation feature flag enabled by default; (D) Kanban added to the doctor's split-service health check; and expanded repair-action coverage. Pipeline A (the `apps/repair-agent` service) gets an authenticated Socket.IO connection via a new `repair` JWT role plus a server-side global error-broadcast room.

**Tech Stack:** NestJS 11, TypeORM (Postgres), `@nestjs/event-emitter` (EventEmitter2), Socket.IO, `jsonwebtoken`, Vitest + SWC, BullMQ. Build NestJS apps with `nest build` (not `tsc`).

---

## Conventions (read before starting)

- **Boundary rule:** `apps/api/src` and `packages/core/src` must stay Kanban-neutral. Do NOT introduce `project`, work-item, or Kanban-domain identifiers. Use neutral `scopeId`/`scope_id`. This is lint-enforced by `nexus-boundaries/no-core-kanban-residue` — never add `eslint-disable`.
- **No lint suppression**, no `@ts-ignore`, no `@deprecated` stubs. Delete dead code outright.
- **Test commands:**
  - Single API test file: `npm run test --workspace=apps/api -- <path-to-spec>`
  - All API tests: `npm run test:api`
  - repair-agent tests: `npm run test --workspace=apps/repair-agent`
- **Typecheck/build:** `npm run build --workspace=packages/core` first if core changed, then `npm run build:api`.
- **Module homes (important):** `WorkflowModule` imports `WorkflowRepairModule` (`apps/api/src/workflow/workflow.module.ts:104`). Therefore `WorkflowRepairModule` **cannot** inject `WORKFLOW_ENGINE_SERVICE` (circular). New listeners that *start* workflows live in **`OperationsModule`** (`apps/api/src/operations/operations.module.ts`), which already imports `WorkflowModule`, exports `WORKFLOW_ENGINE_SERVICE` access, and already hosts `DoctorRepairDelegationListener`.
- `WORKFLOW_ENGINE_SERVICE` token is imported from `apps/api/src/workflow/workflow-engine.interface` (the same path used by other `operations` services — verify the exact path with `grep -rn "WORKFLOW_ENGINE_SERVICE" apps/api/src/operations` in Task A2 Step 1).

---

## File Structure

**Part A — Pipeline B core:**
- Create: `apps/api/src/operations/workflow-failure-doctor-trigger.listener.ts` — scope-agnostic doctor trigger
- Create: `apps/api/src/operations/workflow-failure-doctor-trigger.listener.spec.ts`
- Create: `apps/api/src/operations/sysadmin-repair-request.listener.ts` — starts `workflow_environment_repair`
- Create: `apps/api/src/operations/sysadmin-repair-request.listener.spec.ts`
- Delete: `apps/api/src/automation/workflow-failure-doctor-hook-bootstrap.service.ts` (dead no-op stub)
- Modify: `apps/api/src/automation/automation.module.ts` — remove deleted provider
- Modify: `apps/api/src/operations/operations.module.ts` — register the two new listeners
- Modify: `apps/api/src/settings/system-settings.service.ts` — flip flag default to `true`
- Create: `apps/api/src/database/migrations/20260613000000-enable-repair-delegation-default.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Modify: `apps/api/src/operations/checks/split-service-health.check.ts` — add `kanban` target
- Modify: `docker-compose.yaml` — add `KANBAN_SERVICE_BASE_URL` to `api` env

**Part B — Repair action coverage:**
- Modify: `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts`
- Modify: `apps/api/src/workflow/workflow-repair/repair-policy.config.ts`
- Modify: `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.spec.ts`

**Part C — Pipeline A (repair-agent):**
- Modify: `apps/api/src/telemetry/types.ts` — add `repair` to role union
- Modify: `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts` — accept `repair` role
- Modify: `apps/api/src/telemetry/telemetry-gateway-post-auth.helpers.ts` — join repair room
- Create: `apps/api/src/telemetry/repair-error-broadcast.listener.ts` — broadcast error events to repair room
- Create: `apps/api/src/telemetry/repair-error-broadcast.listener.spec.ts`
- Modify: `apps/api/src/telemetry/telemetry.module.ts` — register the broadcast listener
- Modify: `apps/repair-agent/src/config.ts` + `config.types.ts` — read `JWT_SECRET`
- Modify: `apps/repair-agent/src/connection/telemetry-client.ts` — mint + send JWT, correct subscribe
- Modify: `docker-compose.yaml` — `repair-agent` `depends_on: api`

---

# PART A — Pipeline B: in-process doctor & repair

## Task A1: Scope-agnostic failure-doctor trigger listener

**Why:** Commit `c84d7ed6` gutted `WorkflowFailureDoctorHookBootstrapService` to a no-op, so the per-project automation hook that triggered `workflow_failure_doctor` on `WORKFLOW_RUN_FAILED` is no longer created. DB hooks can't be scope-agnostic (`automation_hooks.scope_id` is non-nullable; `AutomationHooksListener.onWorkflowRunFailed` returns early when `stateVariables.trigger.scopeId` is absent). We replace the dead bootstrap with a direct, scope-agnostic event listener.

**Files:**
- Create: `apps/api/src/operations/workflow-failure-doctor-trigger.listener.ts`
- Test: `apps/api/src/operations/workflow-failure-doctor-trigger.listener.spec.ts`
- Delete: `apps/api/src/automation/workflow-failure-doctor-hook-bootstrap.service.ts`
- Modify: `apps/api/src/automation/automation.module.ts`
- Modify: `apps/api/src/operations/operations.module.ts`

- [ ] **Step 1: Confirm the `WORKFLOW_ENGINE_SERVICE` import path and engine interface**

Run: `grep -rn "WORKFLOW_ENGINE_SERVICE" apps/api/src/operations`
Expected: at least one existing `operations` provider imports it (e.g. `doctor-workflow-repair.service.ts`). Note the exact import path (expected: `../workflow/workflow-engine.interface`) and the interface type name (expected: `IWorkflowEngineService`). Use those exact identifiers in Step 4.

Also run: `grep -rn "WORKFLOW_RUN_FAILED_EVENT" apps/api/src/workflow/workflow-events.constants.ts` and `grep -n "interface WorkflowRunEvent" apps/api/src/workflow/workflow-events.types.ts`
Expected: confirms `WORKFLOW_RUN_FAILED_EVENT = 'workflow.run.failed'` and that `WorkflowRunEvent` has `workflowRunId`, `workflowId`, `status`, `stateVariables`, optional `reason`, `triggerData`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/operations/workflow-failure-doctor-trigger.listener.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { WorkflowFailureDoctorTriggerListener } from './workflow-failure-doctor-trigger.listener';

const DOCTOR_WORKFLOW_DB_ID = 'doctor-workflow-db-id';
const REPAIR_WORKFLOW_DB_ID = 'repair-workflow-db-id';

function createListener() {
  const workflowRepo = {
    findByIdentifier: vi.fn(),
  };
  const workflowEngine = {
    startWorkflow: vi.fn().mockResolvedValue('doctor-run-1'),
  };

  const listener = new WorkflowFailureDoctorTriggerListener(
    workflowRepo as never,
    workflowEngine as never,
  );

  return { listener, workflowRepo, workflowEngine };
}

function failedEvent(overrides: Record<string, unknown> = {}) {
  return {
    workflowRunId: 'failed-run-1',
    workflowId: 'business-workflow-id',
    status: 'failed',
    reason: 'boom',
    stateVariables: { trigger: { scopeId: 'scope-1' } },
    ...overrides,
  };
}

describe('WorkflowFailureDoctorTriggerListener', () => {
  it('starts the doctor workflow on an unrelated workflow failure', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: DOCTOR_WORKFLOW_DB_ID,
      is_active: true,
    });

    await listener.handleWorkflowRunFailed(failedEvent() as never);

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      DOCTOR_WORKFLOW_DB_ID,
      expect.objectContaining({
        event: 'workflow.failure_doctor',
        source: 'workflow_failure_doctor_trigger',
        scopeId: 'scope-1',
        failedWorkflowRunId: 'failed-run-1',
        failedWorkflowId: 'business-workflow-id',
      }),
    );
  });

  it('does not trigger when the failed workflow IS the doctor workflow (no self-loop)', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: DOCTOR_WORKFLOW_DB_ID,
      is_active: true,
    });

    await listener.handleWorkflowRunFailed(
      failedEvent({ workflowId: DOCTOR_WORKFLOW_DB_ID }) as never,
    );

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('does not trigger for the environment repair workflow', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier
      .mockResolvedValueOnce({ id: DOCTOR_WORKFLOW_DB_ID, is_active: true })
      .mockResolvedValueOnce({ id: REPAIR_WORKFLOW_DB_ID, is_active: true });

    await listener.handleWorkflowRunFailed(
      failedEvent({ workflowId: REPAIR_WORKFLOW_DB_ID }) as never,
    );

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('does not trigger the same failed run twice', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: DOCTOR_WORKFLOW_DB_ID,
      is_active: true,
    });

    await listener.handleWorkflowRunFailed(failedEvent() as never);
    await listener.handleWorkflowRunFailed(failedEvent() as never);

    expect(workflowEngine.startWorkflow).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the doctor workflow is missing or inactive', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue(null);

    await listener.handleWorkflowRunFailed(failedEvent() as never);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-failure-doctor-trigger.listener.spec.ts`
Expected: FAIL — cannot find module `./workflow-failure-doctor-trigger.listener`.

- [ ] **Step 4: Implement the listener**

Create `apps/api/src/operations/workflow-failure-doctor-trigger.listener.ts`. Use the import path and interface type confirmed in Step 1 (shown here as the expected values):

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowRepository } from '../workflow/database/repositories/workflow.repository';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import {
  WORKFLOW_ENGINE_SERVICE,
  type IWorkflowEngineService,
} from '../workflow/workflow-engine.interface';

const WORKFLOW_FAILURE_DOCTOR_IDENTIFIER = 'workflow_failure_doctor';
const ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER = 'workflow_environment_repair';

/**
 * Scope-agnostic replacement for the removed per-project failure-doctor
 * automation hook. Triggers the workflow_failure_doctor workflow whenever any
 * workflow run fails, regardless of scope, while guarding against self-trigger
 * loops and duplicate dispatch for the same failed run.
 */
@Injectable()
export class WorkflowFailureDoctorTriggerListener {
  private readonly logger = new Logger(
    WorkflowFailureDoctorTriggerListener.name,
  );
  private readonly triggeredRunIds = new Set<string>();

  constructor(
    private readonly workflowRepo: WorkflowRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
  ) {}

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    try {
      if (this.triggeredRunIds.has(event.workflowRunId)) {
        return;
      }

      const doctorWorkflow = await this.workflowRepo.findByIdentifier(
        WORKFLOW_FAILURE_DOCTOR_IDENTIFIER,
        { includeInactive: true },
      );
      if (!doctorWorkflow?.is_active) {
        return;
      }

      if (await this.isSelfOrRepairWorkflow(event.workflowId, doctorWorkflow.id)) {
        return;
      }

      this.triggeredRunIds.add(event.workflowRunId);

      const runId = await this.workflowEngine.startWorkflow(doctorWorkflow.id, {
        event: 'workflow.failure_doctor',
        source: 'workflow_failure_doctor_trigger',
        scopeId: this.readScopeId(event.stateVariables),
        failedWorkflowRunId: event.workflowRunId,
        failedWorkflowId: event.workflowId,
        failureReason: event.reason ?? null,
      });

      if (!runId) {
        this.triggeredRunIds.delete(event.workflowRunId);
      }
    } catch (error) {
      this.triggeredRunIds.delete(event.workflowRunId);
      this.logger.warn(
        `Failed to trigger workflow failure doctor for run ${event.workflowRunId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async isSelfOrRepairWorkflow(
    failedWorkflowId: string,
    doctorWorkflowId: string,
  ): Promise<boolean> {
    if (failedWorkflowId === doctorWorkflowId) {
      return true;
    }
    const repairWorkflow = await this.workflowRepo.findByIdentifier(
      ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER,
      { includeInactive: true },
    );
    return repairWorkflow?.id === failedWorkflowId;
  }

  private readScopeId(
    stateVariables: Record<string, unknown>,
  ): string | undefined {
    const trigger = stateVariables?.trigger;
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
      return undefined;
    }
    const scopeId = (trigger as Record<string, unknown>).scopeId;
    return typeof scopeId === 'string' && scopeId.trim().length > 0
      ? scopeId.trim()
      : undefined;
  }
}
```

- [ ] **Step 5: Register the listener in OperationsModule**

In `apps/api/src/operations/operations.module.ts`, add the import near the other operations imports:

```typescript
import { WorkflowFailureDoctorTriggerListener } from './workflow-failure-doctor-trigger.listener';
```

And add `WorkflowFailureDoctorTriggerListener` to the `providers` array (next to `DoctorRepairDelegationListener`).

- [ ] **Step 6: Delete the dead bootstrap service and deregister it**

Delete the file `apps/api/src/automation/workflow-failure-doctor-hook-bootstrap.service.ts`.

In `apps/api/src/automation/automation.module.ts`:
- Remove the import line `import { WorkflowFailureDoctorHookBootstrapService } from './workflow-failure-doctor-hook-bootstrap.service';`
- Remove `WorkflowFailureDoctorHookBootstrapService,` from the `providers` array.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-failure-doctor-trigger.listener.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Build the API to verify wiring and no dangling references**

Run: `npm run build:api`
Expected: build succeeds. Also run `grep -rn "WorkflowFailureDoctorHookBootstrapService" apps/api/src` → expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/operations/workflow-failure-doctor-trigger.listener.ts \
        apps/api/src/operations/workflow-failure-doctor-trigger.listener.spec.ts \
        apps/api/src/operations/operations.module.ts \
        apps/api/src/automation/automation.module.ts
git rm apps/api/src/automation/workflow-failure-doctor-hook-bootstrap.service.ts
git commit -m "fix(repair): restore scope-agnostic failure-doctor trigger after kanban split"
```

---

## Task A2: Sysadmin repair request listener

**Why:** `WorkflowRepairDispatchService` emits `REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT` (`workflow-repair-dispatch.service.ts:202`) but no listener consumes it to start the `workflow_environment_repair` workflow. `SysadminRepairCompletionListener` only handles completion. We add the request listener, mirroring `DoctorRepairDelegationListener`. The trigger payload must contain `workflowRunId`, `workflowId`, `policyActionId`, `attempt`, and `failedJobId` so `SysadminRepairCompletionListener.readTriggerContext` can read them back from `stateVariables.trigger`.

**Files:**
- Create: `apps/api/src/operations/sysadmin-repair-request.listener.ts`
- Test: `apps/api/src/operations/sysadmin-repair-request.listener.spec.ts`
- Modify: `apps/api/src/operations/operations.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/operations/sysadmin-repair-request.listener.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { SysadminRepairRequestListener } from './sysadmin-repair-request.listener';
import { REPAIR_DELEGATION_COMPLETED_EVENT } from '../workflow/workflow-repair/repair-delegation.types';

const REPAIR_WORKFLOW_DB_ID = 'repair-workflow-db-id';

function createListener() {
  const workflowRepo = {
    findByIdentifier: vi.fn().mockResolvedValue({
      id: REPAIR_WORKFLOW_DB_ID,
      is_active: true,
    }),
  };
  const workflowEngine = {
    startWorkflow: vi.fn().mockResolvedValue('repair-run-1'),
  };
  const eventEmitter = { emit: vi.fn() };

  const listener = new SysadminRepairRequestListener(
    workflowRepo as never,
    workflowEngine as never,
    eventEmitter as never,
  );

  return { listener, workflowRepo, workflowEngine, eventEmitter };
}

function requestEvent(overrides: Record<string, unknown> = {}) {
  return {
    workflowRunId: 'original-run-1',
    workflowId: 'original-workflow-1',
    failedJobId: 'failed-job-1',
    policyActionId: 'repair.config.create_local_placeholder',
    attempt: 1,
    decision: { eligibility: 'allow', reason: 'r', evidenceReferences: [] },
    ...overrides,
  };
}

describe('SysadminRepairRequestListener', () => {
  it('starts workflow_environment_repair with the original failure context as trigger', async () => {
    const { listener, workflowEngine } = createListener();

    await listener.handleSysadminRepairRequested(requestEvent() as never);

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      REPAIR_WORKFLOW_DB_ID,
      expect.objectContaining({
        workflowRunId: 'original-run-1',
        workflowId: 'original-workflow-1',
        failedJobId: 'failed-job-1',
        policyActionId: 'repair.config.create_local_placeholder',
        attempt: 1,
      }),
    );
  });

  it('emits a failed completion when the repair workflow cannot be found', async () => {
    const { listener, workflowRepo, workflowEngine, eventEmitter } =
      createListener();
    workflowRepo.findByIdentifier.mockResolvedValue(null);

    await listener.handleSysadminRepairRequested(requestEvent() as never);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'failed',
        executionPath: 'sysadmin_workflow',
        policyActionId: 'repair.config.create_local_placeholder',
      }),
    );
  });

  it('emits a failed completion when starting the workflow throws', async () => {
    const { listener, workflowEngine, eventEmitter } = createListener();
    workflowEngine.startWorkflow.mockRejectedValue(new Error('engine down'));

    await listener.handleSysadminRepairRequested(requestEvent() as never);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- sysadmin-repair-request.listener.spec.ts`
Expected: FAIL — cannot find module `./sysadmin-repair-request.listener`.

- [ ] **Step 3: Implement the listener**

Create `apps/api/src/operations/sysadmin-repair-request.listener.ts`:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { WorkflowRepository } from '../workflow/database/repositories/workflow.repository';
import {
  WORKFLOW_ENGINE_SERVICE,
  type IWorkflowEngineService,
} from '../workflow/workflow-engine.interface';
import {
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
  type RepairDelegationCompletedEvent,
  type RepairDelegationRequestEvent,
} from '../workflow/workflow-repair/repair-delegation.types';

const ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER = 'workflow_environment_repair';

/**
 * Consumes sysadmin repair delegation requests and starts the
 * workflow_environment_repair workflow. The original failure context is passed
 * as trigger data so SysadminRepairCompletionListener can correlate completion
 * back to the failed run. Mirrors DoctorRepairDelegationListener.
 */
@Injectable()
export class SysadminRepairRequestListener {
  private readonly logger = new Logger(SysadminRepairRequestListener.name);

  constructor(
    private readonly workflowRepo: WorkflowRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT)
  async handleSysadminRepairRequested(
    event: RepairDelegationRequestEvent,
  ): Promise<void> {
    try {
      const repairWorkflow = await this.workflowRepo.findByIdentifier(
        ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER,
        { includeInactive: true },
      );
      if (!repairWorkflow?.is_active) {
        this.emitFailure(
          event,
          `Repair workflow '${ENVIRONMENT_REPAIR_WORKFLOW_IDENTIFIER}' not found or inactive`,
        );
        return;
      }

      const repairRunId = await this.workflowEngine.startWorkflow(
        repairWorkflow.id,
        {
          event: 'workflow.repair-delegation.sysadmin',
          source: 'sysadmin_repair_request',
          workflowRunId: event.workflowRunId,
          workflowId: event.workflowId,
          failedJobId: event.failedJobId,
          policyActionId: event.policyActionId,
          concreteActionId: event.concreteActionId,
          attempt: event.attempt,
        },
      );

      if (!repairRunId) {
        this.emitFailure(
          event,
          'Repair workflow start returned no run id (skipped by concurrency policy)',
        );
      }
    } catch (error) {
      this.emitFailure(
        event,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private emitFailure(
    event: RepairDelegationRequestEvent,
    message: string,
  ): void {
    this.logger.warn(
      `Sysadmin repair request for run ${event.workflowRunId} failed: ${message}`,
    );
    this.eventEmitter.emit(REPAIR_DELEGATION_COMPLETED_EVENT, {
      workflowRunId: event.workflowRunId,
      workflowId: event.workflowId,
      failedJobId: event.failedJobId,
      policyActionId: event.policyActionId,
      executionPath: 'sysadmin_workflow',
      attempt: event.attempt,
      status: 'failed',
      message,
    } satisfies RepairDelegationCompletedEvent);
  }
}
```

> Note: on the success path this listener does NOT emit a completion event — `SysadminRepairCompletionListener` emits `REPAIR_DELEGATION_COMPLETED_EVENT` once the repair workflow run completes (via `WORKFLOW_RUN_COMPLETED_EVENT`). We only emit a failed completion when the workflow never starts.

- [ ] **Step 4: Register the listener in OperationsModule**

In `apps/api/src/operations/operations.module.ts`, add:

```typescript
import { SysadminRepairRequestListener } from './sysadmin-repair-request.listener';
```

and add `SysadminRepairRequestListener` to the `providers` array.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- sysadmin-repair-request.listener.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Build the API**

Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/operations/sysadmin-repair-request.listener.ts \
        apps/api/src/operations/sysadmin-repair-request.listener.spec.ts \
        apps/api/src/operations/operations.module.ts
git commit -m "fix(repair): add sysadmin repair request listener to start environment repair workflow"
```

---

## Task A3: Enable repair delegation by default

**Why:** `WorkflowRepairDispatchService.dispatchIfAllowed` is gated by `workflow_repair_delegation_enabled`, which defaults to `false` (`system-settings.service.ts`). `seedDefaults()` only inserts when a row is absent, so changing the default helps fresh deploys but not existing databases — a migration upserts the value for existing installs.

**Files:**
- Modify: `apps/api/src/settings/system-settings.service.ts`
- Create: `apps/api/src/database/migrations/20260613000000-enable-repair-delegation-default.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`

- [ ] **Step 1: Flip the default value**

In `apps/api/src/settings/system-settings.service.ts`, find the `WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING` entry in `SYSTEM_SETTING_DEFAULTS` and change `value: false` to `value: true`:

```typescript
  [WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING]: {
    value: true,
    description:
      'Enable config-gated autonomous repair delegation for policy-allowed workflow failures',
  },
```

- [ ] **Step 2: Create the migration**

Create `apps/api/src/database/migrations/20260613000000-enable-repair-delegation-default.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

const SETTING_KEY = 'workflow_repair_delegation_enabled';
const SETTING_DESCRIPTION =
  'Enable config-gated autonomous repair delegation for policy-allowed workflow failures';

export class EnableRepairDelegationDefault20260613000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_settings (key, value, description, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
      [SETTING_KEY, JSON.stringify(true), SETTING_DESCRIPTION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE system_settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`,
      [SETTING_KEY, JSON.stringify(false)],
    );
  }
}
```

- [ ] **Step 3: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`:
- Add the import at the top (above the existing newest import):

```typescript
import { EnableRepairDelegationDefault20260613000000 } from './20260613000000-enable-repair-delegation-default';
```

- Add `EnableRepairDelegationDefault20260613000000,` as the FIRST entry of the `registeredMigrations` array (the array is in reverse-chronological order; newest first).

- [ ] **Step 4: Build the API**

Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/settings/system-settings.service.ts \
        apps/api/src/database/migrations/20260613000000-enable-repair-delegation-default.ts \
        apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(repair): enable workflow repair delegation by default"
```

---

## Task A4: Add Kanban to the doctor's split-service health check

**Why:** `SPLIT_SERVICE_TARGETS` only includes `chat`. After the Kanban split, the doctor's `split_service_connectivity_check` does not inspect the `kanban` service. We add it.

**Files:**
- Modify: `apps/api/src/operations/checks/split-service-health.check.ts`
- Modify: `docker-compose.yaml`

- [ ] **Step 1: Read the current target type and array**

Read `apps/api/src/operations/checks/split-service-health.check.ts` lines 1–30. Confirm `SplitServiceTarget` is `{ service: 'chat'; baseUrlEnv: 'CHAT_SERVICE_BASE_URL'; }` and `SPLIT_SERVICE_TARGETS` has the single `chat` entry.

- [ ] **Step 2: Widen the type and add the kanban target**

Edit the `SplitServiceTarget` interface to a union:

```typescript
interface SplitServiceTarget {
  service: 'chat' | 'kanban';
  baseUrlEnv: 'CHAT_SERVICE_BASE_URL' | 'KANBAN_SERVICE_BASE_URL';
}
```

Edit `SPLIT_SERVICE_TARGETS`:

```typescript
const SPLIT_SERVICE_TARGETS: SplitServiceTarget[] = [
  {
    service: 'chat',
    baseUrlEnv: 'CHAT_SERVICE_BASE_URL',
  },
  {
    service: 'kanban',
    baseUrlEnv: 'KANBAN_SERVICE_BASE_URL',
  },
];
```

- [ ] **Step 3: Ensure the env var is provided to the API service**

In `docker-compose.yaml`, in the `api` service `environment:` block (near the existing `KANBAN_CORE_BASE_URL` line), add:

```yaml
      - KANBAN_SERVICE_BASE_URL=${KANBAN_SERVICE_BASE_URL:-http://kanban:3012/api}
```

- [ ] **Step 4: Run the existing check test (if present) and build**

Run: `npm run test --workspace=apps/api -- split-service-health.check.spec.ts` (skip if no spec exists)
Expected: PASS or "no test files".
Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/operations/checks/split-service-health.check.ts docker-compose.yaml
git commit -m "fix(doctor): include kanban service in split-service connectivity check"
```

---

# PART B — Repair action coverage

## Task B1: Expand the repair executor registry and policy config

**Why:** `RepairExecutorRegistryService.resolveExecutionPlan` maps only 3 policy action IDs; `tool_contract_mismatch`, `credential_missing`, and `ambiguous_failure` have empty `allowedRepairActionIds` and always deny. We add safe, doctor-backed automated actions for runtime-recoverable classes, mapping each new policy action ID to an existing `DoctorRepairActionId`. We deliberately leave `tool_contract_mismatch` and `ambiguous_failure` human-required (no safe automated remediation), and `credential_missing` empty (secrets must not be auto-created).

The six existing concrete `DoctorRepairActionId`s are: `clear_stale_polling_markers`, `requeue_recoverable_workflow_runs`, `prune_orphaned_runtime_artifacts`, `refresh_mcp_plugin_catalogs`, `clean_git_worktrees`, `recover_api_fetch_failures`.

**Files:**
- Modify: `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts`
- Modify: `apps/api/src/workflow/workflow-repair/repair-policy.config.ts`
- Test: `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.spec.ts`

- [ ] **Step 1: Write/extend the failing test**

Read `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.spec.ts` first to match the existing structure, then add these cases inside its `describe` block:

```typescript
  it('maps stale runtime artifact refresh to the doctor prune action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.runtime_artifact.refresh_stale_artifacts',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
      concreteActionId: 'prune_orphaned_runtime_artifacts',
    });
  });

  it('maps stale polling markers to the doctor clear action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.polling.clear_stale_markers',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.polling.clear_stale_markers',
      concreteActionId: 'clear_stale_polling_markers',
    });
  });

  it('maps recoverable run requeue to the doctor requeue action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.workflow_run.requeue_recoverable',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.workflow_run.requeue_recoverable',
      concreteActionId: 'requeue_recoverable_workflow_runs',
    });
  });

  it('maps api fetch recovery to the doctor recover action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.api.recover_fetch_failures',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.api.recover_fetch_failures',
      concreteActionId: 'recover_api_fetch_failures',
    });
  });

  it('returns null for unknown action ids', () => {
    expect(service.resolveExecutionPlan('unknown.action')).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `npm run test --workspace=apps/api -- repair-executor-registry.service.spec.ts`
Expected: FAIL — new mappings return `null`.

- [ ] **Step 3: Expand the registry**

Replace the body of `resolveExecutionPlan` in `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type { DoctorRepairActionId } from '../../operations/doctor.types';
import type { RepairExecutionPlan } from './repair-delegation.types';

const DOCTOR_PLAN_BY_POLICY_ACTION: Record<string, DoctorRepairActionId> = {
  'doctor.runtime_artifact.refresh_stale_artifacts':
    'prune_orphaned_runtime_artifacts',
  'doctor.polling.clear_stale_markers': 'clear_stale_polling_markers',
  'doctor.workflow_run.requeue_recoverable': 'requeue_recoverable_workflow_runs',
  'doctor.mcp.refresh_plugin_catalogs': 'refresh_mcp_plugin_catalogs',
  'doctor.git.clean_worktrees': 'clean_git_worktrees',
  'doctor.api.recover_fetch_failures': 'recover_api_fetch_failures',
};

const SYSADMIN_POLICY_ACTIONS = new Set<string>([
  'repair.dependency.add_declared_package',
  'repair.config.create_local_placeholder',
]);

@Injectable()
export class RepairExecutorRegistryService {
  resolveExecutionPlan(policyActionId: string): RepairExecutionPlan | null {
    const concreteActionId = DOCTOR_PLAN_BY_POLICY_ACTION[policyActionId];
    if (concreteActionId) {
      return { path: 'doctor', policyActionId, concreteActionId };
    }

    if (SYSADMIN_POLICY_ACTIONS.has(policyActionId)) {
      return { path: 'sysadmin_workflow', policyActionId };
    }

    return null;
  }
}
```

- [ ] **Step 4: Populate previously-empty policy classes with safe actions**

In `apps/api/src/workflow/workflow-repair/repair-policy.config.ts`, update the `runtime_artifact_stale` class to include the additional runtime-recovery actions, and give `ambiguous_failure` a conservative diagnostic action while keeping it human-required as a fallback. Leave `tool_contract_mismatch` and `credential_missing` empty (no safe automated remediation). Replace the relevant entries:

```typescript
  runtime_artifact_stale: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [
      'doctor.runtime_artifact.refresh_stale_artifacts',
      'doctor.polling.clear_stale_markers',
      'doctor.workflow_run.requeue_recoverable',
      'doctor.git.clean_worktrees',
    ],
    humanRequired: false,
    defaultExecutor: 'doctor',
    diagnosticLabel: 'Runtime artifact stale',
  },
```

> Do NOT add actions to `credential_missing` (secrets must be provisioned by a human) or `tool_contract_mismatch` / `ambiguous_failure` (no deterministic safe fix). Keep their `allowedRepairActionIds: []` and `humanRequired` as currently set.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- repair-executor-registry.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the repair-policy and dispatch tests to confirm no regressions**

Run: `npm run test --workspace=apps/api -- repair-policy.service.spec.ts workflow-repair-dispatch.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Build the API**

Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts \
        apps/api/src/workflow/workflow-repair/repair-policy.config.ts \
        apps/api/src/workflow/workflow-repair/repair-executor-registry.service.spec.ts
git commit -m "feat(repair): expand repair action coverage to runtime-recoverable doctor actions"
```

---

# PART C — Pipeline A: repair-agent connectivity

> **Design note:** The `TelemetryGateway` (`@WebSocketGateway(TELEMETRY_GATEWAY_PORT)`, root namespace) authenticates every Socket.IO client via a JWT in `client.handshake.auth.token` and only fans events out per-run to UI/agent clients via Redis pubsub. There is **no global error feed**. We add a dedicated `repair` JWT role: such clients join a single broadcast room (`/repair/errors`), and a new server-side listener emits error/critical workflow events into that room. The repair-agent mints its own short-lived service JWT using the shared `JWT_SECRET` (it already depends on `jsonwebtoken`).

## Task C1: Server — accept the `repair` role and join the broadcast room

**Files:**
- Modify: `apps/api/src/telemetry/types.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-post-auth.helpers.ts`

- [ ] **Step 1: Read the current role typing**

Read `apps/api/src/telemetry/types.ts` and find the `AuthenticatedSocket` definition and its `role` field (expected `'agent' | 'ui'`). Read `telemetry-gateway-connection.helpers.ts:33-75` (JWT decode) and `telemetry-gateway-post-auth.helpers.ts:1-64` (room joins).

- [ ] **Step 2: Add `'repair'` to the role union**

In `apps/api/src/telemetry/types.ts`, widen every `role?: 'agent' | 'ui'` occurrence (on `AuthenticatedSocket`) to `role?: 'agent' | 'ui' | 'repair'`.

- [ ] **Step 3: Accept the role at connection time**

In `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts`:
- In the `jwt.verify` decoded type annotation, the `role: string` field already accepts any string; change the cast `client.role = decoded.role as 'agent' | 'ui';` to `client.role = decoded.role as 'agent' | 'ui' | 'repair';`.
- A `repair` client carries no `workflowRunId`/`stepId`, so the existing `streamId` logic resolves to `undefined` and the client will not join a per-run room — that's intended.

- [ ] **Step 4: Join the repair room in post-auth**

In `apps/api/src/telemetry/telemetry-gateway-post-auth.helpers.ts`, add a `'repair'` branch and widen the `client.role` type in the param interface to include `'repair'`. Add this block before the `client.role === 'ui'` block:

```typescript
  if (client.role === 'repair') {
    await client.join('/repair/errors');
    return;
  }
```

Also update the param type: change `role?: 'agent' | 'ui';` to `role?: 'agent' | 'ui' | 'repair';` in the `params.client` type literal.

- [ ] **Step 5: Build the API**

Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/telemetry/types.ts \
        apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts \
        apps/api/src/telemetry/telemetry-gateway-post-auth.helpers.ts
git commit -m "feat(telemetry): add repair socket role and global error room"
```

---

## Task C2: Server — broadcast error events to the repair room

**Files:**
- Create: `apps/api/src/telemetry/repair-error-broadcast.listener.ts`
- Test: `apps/api/src/telemetry/repair-error-broadcast.listener.spec.ts`
- Modify: `apps/api/src/telemetry/telemetry.module.ts`

- [ ] **Step 1: Confirm how to reach the Socket.IO server and the failed event payload**

Read `apps/api/src/telemetry/telemetry.gateway.ts:79-86` — the gateway exposes `server: Server` (Socket.IO). Read `apps/api/src/workflow/workflow-events.types.ts` to confirm `WorkflowRunEvent` fields (`workflowRunId`, `workflowId`, `status`, optional `reason`).

We will inject the `TelemetryGateway` into a small listener and emit to the room via `gateway.server.to('/repair/errors').emit('event', payload)`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/telemetry/repair-error-broadcast.listener.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { RepairErrorBroadcastListener } from './repair-error-broadcast.listener';

function createListener() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const gateway = { server: { to } };
  const listener = new RepairErrorBroadcastListener(gateway as never);
  return { listener, to, emit };
}

describe('RepairErrorBroadcastListener', () => {
  it('broadcasts a failed run as an error event to the repair room', () => {
    const { listener, to, emit } = createListener();

    listener.handleWorkflowRunFailed({
      workflowRunId: 'run-1',
      workflowId: 'wf-1',
      status: 'failed',
      reason: 'container exited 1',
      stateVariables: {},
    } as never);

    expect(to).toHaveBeenCalledWith('/repair/errors');
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({
        payload: expect.objectContaining({
          severity: 'error',
          domain: 'workflow',
          eventName: 'workflow.run.failed',
          errorMessage: 'container exited 1',
          workflowRunId: 'run-1',
          workflowId: 'wf-1',
        }),
      }),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- repair-error-broadcast.listener.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the listener**

Create `apps/api/src/telemetry/repair-error-broadcast.listener.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { TelemetryGateway } from './telemetry.gateway';

const REPAIR_ERROR_ROOM = '/repair/errors';
const FAILED_RUN_ERROR_CODE = 'workflow_run_failed';

/**
 * Bridges in-process workflow failure events to the repair-agent broadcast room
 * so the standalone repair-agent receives actionable error events with the
 * errorCode/errorMessage fields it filters on.
 */
@Injectable()
export class RepairErrorBroadcastListener {
  constructor(private readonly gateway: TelemetryGateway) {}

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  handleWorkflowRunFailed(event: WorkflowRunEvent): void {
    const server = this.gateway.server;
    if (!server) {
      return;
    }

    server.to(REPAIR_ERROR_ROOM).emit('event', {
      timestamp: new Date().toISOString(),
      payload: {
        severity: 'error',
        domain: 'workflow',
        eventName: WORKFLOW_RUN_FAILED_EVENT,
        errorCode: FAILED_RUN_ERROR_CODE,
        errorMessage: event.reason ?? 'Workflow run failed',
        workflowId: event.workflowId,
        workflowRunId: event.workflowRunId,
      },
    });
  }
}
```

- [ ] **Step 5: Register the listener in TelemetryModule**

In `apps/api/src/telemetry/telemetry.module.ts`, import `RepairErrorBroadcastListener` and add it to the `providers` array (it depends on `TelemetryGateway`, which is already provided in this module).

- [ ] **Step 6: Run the test to verify it passes, then build**

Run: `npm run test --workspace=apps/api -- repair-error-broadcast.listener.spec.ts`
Expected: PASS.
Run: `npm run build:api`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/telemetry/repair-error-broadcast.listener.ts \
        apps/api/src/telemetry/repair-error-broadcast.listener.spec.ts \
        apps/api/src/telemetry/telemetry.module.ts
git commit -m "feat(telemetry): broadcast workflow failures to repair-agent error room"
```

---

## Task C3: repair-agent — authenticate the Socket.IO connection

**Files:**
- Modify: `apps/repair-agent/src/config.types.ts`
- Modify: `apps/repair-agent/src/config.ts`
- Modify: `apps/repair-agent/src/connection/telemetry-client.ts`

- [ ] **Step 1: Read current config and client**

Read `apps/repair-agent/src/config.types.ts`, `apps/repair-agent/src/config.ts`, and `apps/repair-agent/src/connection/telemetry-client.ts`. Confirm `jsonwebtoken` is a dependency (it is, per `package.json`).

- [ ] **Step 2: Add `jwtSecret` to the config type and loader**

In `apps/repair-agent/src/config.types.ts`, add to the `RepairAgentConfig` interface:

```typescript
  jwtSecret: string;
```

In `apps/repair-agent/src/config.ts`, inside `loadConfig()` add a required read (place near the `databaseUrl` check):

```typescript
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
```

and add `jwtSecret,` to the returned object.

- [ ] **Step 3: Pass the secret into the client and send an auth token**

In `apps/repair-agent/src/connection/telemetry-client.ts`:
- Add `import jwt from 'jsonwebtoken';` at the top.
- Change the constructor to accept the secret: `constructor(url: string, private readonly jwtSecret: string) {` (keep the existing `super()` and URL parsing).
- In `connect()`, mint a token and pass it in the `io()` auth handshake. Replace the `io(this.baseUrl, {...})` call with:

```typescript
    const token = jwt.sign({ role: 'repair' }, this.jwtSecret, {
      expiresIn: '1h',
    });

    this.socket = io(this.baseUrl, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
```

- The server now pushes events to the `/repair/errors` room automatically on join; the prior `this.socket?.emit('subscribe', {...})` call has no server handler. Remove the `emit('subscribe', ...)` block inside the `connect` handler (the role-based room join replaces it). Keep the `'event'` listener as-is.
- Because tokens expire hourly, re-mint on reconnect: in the `connect` event handler, the socket reuses the original `auth` token; to refresh, set `this.socket.auth = { token: jwt.sign({ role: 'repair' }, this.jwtSecret, { expiresIn: '1h' }) };` at the top of the `reconnect_attempt` handler. Add:

```typescript
    this.socket.io.on('reconnect_attempt', () => {
      if (this.socket) {
        this.socket.auth = {
          token: jwt.sign({ role: 'repair' }, this.jwtSecret, {
            expiresIn: '1h',
          }),
        };
      }
    });
```

- [ ] **Step 4: Update the caller in repair-agent.ts**

In `apps/repair-agent/src/repair-agent.ts`, change:

```typescript
  const telemetryClient = new TelemetryClient(config.telemetryUrl);
```

to:

```typescript
  const telemetryClient = new TelemetryClient(config.telemetryUrl, config.jwtSecret);
```

- [ ] **Step 5: Update or add a config test**

If `apps/repair-agent/tests/` has a config test, update it to set `JWT_SECRET`. Otherwise add `apps/repair-agent/tests/config.spec.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('loadConfig', () => {
  it('throws when JWT_SECRET is missing', () => {
    process.env.DATABASE_URL = 'postgres://x';
    delete process.env.JWT_SECRET;
    expect(() => loadConfig()).toThrow('JWT_SECRET');
  });

  it('returns jwtSecret when provided', () => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.JWT_SECRET = 'secret';
    expect(loadConfig().jwtSecret).toBe('secret');
  });
});
```

- [ ] **Step 6: Run repair-agent tests and typecheck**

Run: `npm run test --workspace=apps/repair-agent`
Expected: PASS.
Run: `npm run typecheck --workspace=apps/repair-agent`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/repair-agent/src/config.types.ts apps/repair-agent/src/config.ts \
        apps/repair-agent/src/connection/telemetry-client.ts \
        apps/repair-agent/src/repair-agent.ts \
        apps/repair-agent/tests/config.spec.ts
git commit -m "fix(repair-agent): authenticate telemetry socket with repair-role JWT"
```

---

## Task C4: docker-compose — repair-agent depends on API

**Files:**
- Modify: `docker-compose.yaml`

- [ ] **Step 1: Add the API dependency**

In the `repair-agent` service `depends_on:` block (currently only `postgres`), add the `api` service so the repair-agent starts after the API gateway is healthy:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      api:
        condition: service_healthy
```

> Confirm the `api` service defines a `healthcheck`. If it does not, use `condition: service_started` instead.

- [ ] **Step 2: Confirm JWT_SECRET is already present**

The `repair-agent` service already has `- JWT_SECRET=${JWT_SECRET:-nexus-e2e-secret}` in its `environment:` block — confirm it matches the `api` service's `JWT_SECRET` (both default to `nexus-e2e-secret`). They MUST be identical for token verification to succeed.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yaml
git commit -m "chore(compose): start repair-agent after api is healthy"
```

---

# Final Verification

- [ ] **Step 1: Full API test suite**

Run: `npm run test:api`
Expected: all tests pass.

- [ ] **Step 2: repair-agent test suite**

Run: `npm run test --workspace=apps/repair-agent`
Expected: all tests pass.

- [ ] **Step 3: Lint the touched workspaces**

Run: `npm run lint:api` and `npm run lint --workspace=apps/repair-agent`
Expected: no errors, no warnings (strict policy — no suppressions).

- [ ] **Step 4: Build everything**

Run: `npm run build --workspace=packages/core && npm run build:api && npm run build --workspace=apps/repair-agent`
Expected: all builds succeed.

- [ ] **Step 5: End-to-end smoke (manual, optional)**

Run: `docker compose up -d --build`. Force a workflow failure and confirm in logs:
1. `WorkflowFailureDoctorTriggerListener` starts `workflow_failure_doctor` (Part A1).
2. With `workflow_repair_delegation_enabled=true`, a sysadmin-classified failure starts `workflow_environment_repair` (Parts A2/A3).
3. The `repair-agent` container connects to telemetry without immediate disconnect and logs receipt of an `event` on a failure (Part C).
4. `bd`/doctor report includes the `kanban` service in split-service connectivity (Part A4).

- [ ] **Step 6: Update documentation**

Update `docs/analysis/ANALYSIS-self-healing-repair-2026.md` — mark the Definition-of-Done checkboxes that this work satisfies, and note the chosen scope-agnostic-listener approach for the doctor trigger (it replaces the removed DB-hook bootstrap).

- [ ] **Step 7: Push**

```bash
git pull --rebase
git push
git status   # verify "up to date with origin"
```

---

## Self-Review Notes

- **Spec coverage:** Root Cause 1 → Task A1; Root Cause 2 → Task A2; Root Cause 3 → Task A3; Root Cause 4 → Tasks C1–C4; Gap A (kanban health) → Task A4; Gap B (action coverage) → Task B1. All findings from the analysis are covered.
- **Design correction captured:** The analysis suggested "restore the bootstrap service," but the per-project model and `ProjectRepository` no longer exist and would violate the Kanban boundary. Task A1 implements the user-approved scope-agnostic approach as a direct event listener instead (DB hooks cannot be scope-agnostic — `automation_hooks.scope_id` is non-nullable and `AutomationHooksListener` requires a `scopeId`).
- **Type consistency:** `IWorkflowEngineService`/`WORKFLOW_ENGINE_SERVICE`, `RepairDelegationRequestEvent`/`RepairDelegationCompletedEvent`, and `DoctorRepairActionId` member names are used consistently with the existing source. Step A2.1 and C1.1/C2.1 require confirming exact import paths before coding, since those are the only identifiers not already quoted verbatim from the codebase.
- **Circular-dependency guard:** New workflow-starting listeners live in `OperationsModule` (which already imports `WorkflowModule`), NOT in `WorkflowRepairModule` (which `WorkflowModule` imports), avoiding a cycle.
