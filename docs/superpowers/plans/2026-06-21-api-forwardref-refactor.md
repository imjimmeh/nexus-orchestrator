# API `forwardRef` Circular-Dependency Elimination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove circular module dependencies in `apps/api/src` so the NestJS module graph is a DAG and `forwardRef` is reserved only for documented, accepted intra-module service cycles.

**Architecture:** Invert dependencies toward leaf modules and move startup orchestration to the composition root. Five mechanisms (A event-inversion of telemetry, B bootstrap extraction from DatabaseModule, C leaf AuditModule, D defensive-forwardRef sweep, E registry leaves for local service cycles). See design doc `docs/plans/2026-06-21-api-forwardref-refactor-design.md`.

**Tech Stack:** NestJS 11, `@nestjs/event-emitter` (already present), Vitest (`--project unit` / `--project integration`, testcontainers available), `madge` (to be added) for static cycle tracking.

## Global Constraints

- **Never suppress lint** — no `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, rule downgrades. Fix in code. (CLAUDE.md strict lint policy.)
- **Never add `@Global()`** modules, allowlists, or compatibility re-exports/aliases to bypass a cycle. The codebase is removing `@Global()` (commit `983452142`).
- **Kanban-neutral boundary** — no kanban/work-item/project-domain identifiers in `apps/api` or `packages/core`. (CLAUDE.md Core/Kanban Boundary.)
- **TDD Red-Green-Refactor** for every change; small atomic commits explaining _why_.
- **Build with `nest build`** (not `tsc`) — `npm run build:api`.
- **Per-change gate (applies to every task):** after a structural change run, in order:
  1. `npm run build --workspace=apps/api` — must compile.
  2. `npm run test:integration --workspace=apps/api -t "AppModule boots"` — DI graph must resolve (the boot spec from Task 0.2). A removed-but-needed `forwardRef` throws `Nest cannot create the module instance / circular dependency` here.
  3. `npm run madge:circular --workspace=apps/api` — circular count must be **≤ the prior baseline**, never higher.
- **Shared interfaces** live in `apps/api/src/shared/interfaces/` (established pattern: `telemetry-gateway.interface.ts`, `session-hydration.interface.ts`). New cross-cutting tokens go there.

---

## Phase 0 — Make cycles visible and boot verifiable (prerequisite)

### Task 0.1: Add `madge` circular-dependency tracking script

**Files:**

- Modify: `apps/api/package.json` (scripts + devDependency)
- Create: `apps/api/.madgerc`

**Interfaces:**

- Produces: npm script `madge:circular` (in `apps/api`) printing the list and count of circular import chains under `src`.

- [ ] **Step 1: Add the dev dependency**

Run: `npm install --save-dev --workspace=apps/api madge@^8.0.0`
Expected: `madge` appears under `devDependencies` in `apps/api/package.json`.

- [ ] **Step 2: Create `apps/api/.madgerc`**

```json
{
  "fileExtensions": ["ts"],
  "tsConfig": "tsconfig.json",
  "detectiveOptions": {
    "ts": { "skipTypeImports": true }
  },
  "excludeRegExp": ["\\.spec\\.ts$", "\\.e2e-spec\\.ts$", "/node_modules/"]
}
```

`skipTypeImports` keeps `import type` (interface-only) edges from counting as runtime cycles.

- [ ] **Step 3: Add the script**

In `apps/api/package.json` `scripts`, add:

```json
"madge:circular": "madge --circular --extensions ts src"
```

- [ ] **Step 4: Run it to capture the baseline**

Run: `npm run madge:circular --workspace=apps/api`
Expected: prints a non-empty list of circular chains and a summary count (e.g. `Found N circular dependencies`). Record N.

- [ ] **Step 5: Record the baseline in the plan tracking file**

Create `apps/api/CIRCULAR_BASELINE.md` containing the exact `madge:circular` output and the integer N with today's date. This is the ratchet target Phase 7 will enforce.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/.madgerc apps/api/CIRCULAR_BASELINE.md package-lock.json
git commit -m "chore(api): add madge circular-dependency tracking + baseline"
```

### Task 0.2: Add an AppModule boot smoke test (DI-graph resolution gate)

**Files:**

- Create: `apps/api/test/app-module-boot.integration-spec.ts`

**Interfaces:**

- Produces: an integration test named `"AppModule boots"` that compiles and initialises the full `AppModule`, proving the DI graph resolves with no unsatisfied or circular dependencies.

- [ ] **Step 1: Confirm the integration harness and AppModule path**

Run: `npm run test:integration --workspace=apps/api -t "nonexistent placeholder"`
Expected: vitest runs the `integration` project and reports 0 matching tests (confirms the project + testcontainers harness are wired). Note from the output how existing integration specs bootstrap Postgres/Redis (reuse that setup).

- [ ] **Step 2: Write the failing boot test**

```typescript
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module";

describe("AppModule boots", () => {
  let app: INestApplication | undefined;

  afterAll(async () => {
    await app?.close();
  });

  it("resolves the full DI graph and initialises without circular errors", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    expect(app).toBeDefined();
  });
});
```

> If the existing integration project already provides a global Postgres/Redis/Docker testcontainer
> setup (Step 1), this test inherits it. If `app.init()` requires external services not present in
> the unit harness, place this spec so it runs under `--project integration`, which has
> `testcontainers` available.

- [ ] **Step 3: Run it — expect PASS on current code**

Run: `npm run test:integration --workspace=apps/api -t "AppModule boots"`
Expected: PASS (the app currently boots _with_ its `forwardRef`s). If it fails, fix the harness wiring before proceeding — this test is the safety net for every later phase.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/app-module-boot.integration-spec.ts
git commit -m "test(api): add AppModule boot smoke test as DI-graph regression gate"
```

---

## Phase 1 — Defensive-`forwardRef` sweep (Mechanism D)

Repeatable, verified procedure applied **one edge at a time**. Each candidate is its own micro-task:
convert `forwardRef(() => X)` → `X`, run the per-change gate, keep if green, revert if the boot test
throws (meaning the edge was genuinely cyclic — leave it for Phases 2–6).

### Task 1.1: Build the verified candidate list

**Files:** none (analysis) — output recorded in `apps/api/CIRCULAR_BASELINE.md`.

- [ ] **Step 1: Enumerate every `forwardRef` edge**

Run: `npm run madge:circular --workspace=apps/api` and, separately, grep the source:
`grep -rn "forwardRef" apps/api/src --include=*.module.ts --include=*.service.ts`

- [ ] **Step 2: For each edge `A → forwardRef(B)`, classify by checking the back-edge**

For each, inspect `B`'s module/providers for any import or injection of `A`. If **none** exists, mark
`CANDIDATE` (Phase 1). If a back-edge exists, mark `STRUCTURAL` and route to the owning phase
(2/3/4/5/6). Record the table in `CIRCULAR_BASELINE.md`.

Initial `CANDIDATE` set (each must still be individually verified by the gate, not trusted):
`workflow-await → SessionModule`, `workflow-subagents → SessionModule`,
`workflow-interruption-recovery → SessionModule`, `workflow-step-execution → SessionModule`,
`workflow-run-operations → SessionModule`, `observability → AuthModule`,
`observability → DatabaseModule`, `learning → WorkflowCoreModule`,
`learning → WorkflowKernelModule`, `memory → PluginKernelModule`,
`security → CapabilityGovernanceModule`.

- [ ] **Step 3: Commit the classification**

```bash
git add apps/api/CIRCULAR_BASELINE.md
git commit -m "docs(api): classify forwardRef edges (candidate vs structural)"
```

### Task 1.2 … 1.N: Convert one candidate edge (repeat per `CANDIDATE`)

> Run this five-step loop **once per candidate edge**. Do not batch — batching hides which edge broke
> the boot. Example shown for `workflow-await → SessionModule`; substitute file/symbol per edge.

**Files:**

- Modify: the source module file (e.g. `apps/api/src/workflow/workflow-await/workflow-await.module.ts`)

- [ ] **Step 1: Remove the `forwardRef` wrapper**

In the `imports` array, change `forwardRef(() => SessionModule)` to `SessionModule`. If this removes
the last `forwardRef` usage in the file, also drop `forwardRef` from the `@nestjs/common` import.

- [ ] **Step 2: Build**

Run: `npm run build --workspace=apps/api`
Expected: PASS.

- [ ] **Step 3: Boot gate**

Run: `npm run test:integration --workspace=apps/api -t "AppModule boots"`
Expected: PASS → the edge was defensive; keep the change. FAIL with a circular/cannot-create error →
the edge is structural; `git checkout` the file and re-tag it `STRUCTURAL` in `CIRCULAR_BASELINE.md`.

- [ ] **Step 4: Cycle metric**

Run: `npm run madge:circular --workspace=apps/api`
Expected: count ≤ baseline (typically −1 per kept change). Update the recorded count.

- [ ] **Step 5: Commit (only if kept)**

```bash
git add apps/api/src/workflow/workflow-await/workflow-await.module.ts apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): drop defensive forwardRef workflow-await -> SessionModule"
```

---

## Phase 2 — Extract `BootstrapModule` from `DatabaseModule` (Mechanism B)

Breaks `DatabaseModule ↔ SecurityModule` and removes `forwardRef(IAMPolicyService)` in
`StartupSeedService` by moving seed _orchestration_ to the composition root.

### Task 2.1: Move seeding orchestration to a root `BootstrapModule`

**Files:**

- Create: `apps/api/src/bootstrap/bootstrap.module.ts`
- Create: `apps/api/src/bootstrap/bootstrap.service.ts`
- Create: `apps/api/src/bootstrap/bootstrap.service.spec.ts`
- Modify: `apps/api/src/database/seeds/startup-seed.service.ts` (remove `IAMPolicyService` dependency + its `refreshPolicies()` call)
- Modify: `apps/api/src/database/database.module.ts` (remove `OnModuleInit`, `forwardRef(SecurityModule)`, and the `startupSeedService` constructor)
- Modify: `apps/api/src/app.module.ts` (import `BootstrapModule`)

**Interfaces:**

- Consumes: `StartupSeedService.seedOnStartup()` (existing, minus IAM refresh), `IAMPolicyService.refreshPolicies()` (existing, from `SecurityModule`).
- Produces: `BootstrapService.onApplicationBootstrap()` runs `seedOnStartup()` then `iamPolicyService.refreshPolicies()`.

- [ ] **Step 1: Write the failing test for `BootstrapService`**

```typescript
import { Test } from "@nestjs/testing";
import { BootstrapService } from "./bootstrap.service";
import { StartupSeedService } from "../database/seeds/startup-seed.service";
import { IAMPolicyService } from "../security/iam-policy.service";

describe("BootstrapService", () => {
  it("seeds then refreshes IAM policies on application bootstrap, in order", async () => {
    const calls: string[] = [];
    const seed = {
      seedOnStartup: vi.fn(async () => {
        calls.push("seed");
      }),
    };
    const iam = {
      refreshPolicies: vi.fn(async () => {
        calls.push("iam");
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BootstrapService,
        { provide: StartupSeedService, useValue: seed },
        { provide: IAMPolicyService, useValue: iam },
      ],
    }).compile();

    await moduleRef.get(BootstrapService).onApplicationBootstrap();

    expect(calls).toEqual(["seed", "iam"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (BootstrapService undefined)**

Run: `npm run test --workspace=apps/api -t "BootstrapService"`
Expected: FAIL — cannot find module `./bootstrap.service`.

- [ ] **Step 3: Implement `BootstrapService`**

```typescript
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { StartupSeedService } from "../database/seeds/startup-seed.service";
import { IAMPolicyService } from "../security/iam-policy.service";

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly startupSeedService: StartupSeedService,
    private readonly iamPolicyService: IAMPolicyService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.debug("BootstrapService: seeding on application bootstrap...");
    await this.startupSeedService.seedOnStartup();
    this.logger.debug("BootstrapService: refreshing IAM policies...");
    await this.iamPolicyService.refreshPolicies();
    this.logger.debug("BootstrapService: bootstrap complete.");
  }
}
```

- [ ] **Step 4: Implement `BootstrapModule`**

```typescript
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { SecurityModule } from "../security/security.module";
import { BootstrapService } from "./bootstrap.service";

@Module({
  imports: [DatabaseModule, SecurityModule],
  providers: [BootstrapService],
})
export class BootstrapModule {
  protected readonly _moduleName = "BootstrapModule";
}
```

- [ ] **Step 5: Remove IAM refresh + dependency from `StartupSeedService`**

In `apps/api/src/database/seeds/startup-seed.service.ts`: delete the `@Inject(forwardRef(() => IAMPolicyService))` constructor parameter and the `import` of `IAMPolicyService`, and delete the
final two lines of `seedOnStartup()` that log + call `this.iamPolicyService.refreshPolicies()`. Drop
`forwardRef`/`Inject` from the `@nestjs/common` import if now unused.

- [ ] **Step 6: Make `DatabaseModule` a leaf**

In `apps/api/src/database/database.module.ts`: remove `forwardRef(() => SecurityModule)` from
`imports`; remove `implements OnModuleInit`, the `onModuleInit()` method, the `startupSeedService`
constructor, and now-unused imports (`forwardRef`, `OnModuleInit`, `Logger` if unused). Keep
`StartupSeedService` in `providers`/`exports` (BootstrapModule consumes it via `DatabaseModule`).

- [ ] **Step 7: Mount `BootstrapModule` at the root**

In `apps/api/src/app.module.ts`, add `BootstrapModule` to the `imports` array.

- [ ] **Step 8: Run the unit test — expect PASS**

Run: `npm run test --workspace=apps/api -t "BootstrapService"`
Expected: PASS.

- [ ] **Step 9: Per-change gate (build + boot + madge)**

Run the three Global-Constraints gate commands. Expected: build PASS; `"AppModule boots"` PASS
(seeding now runs on bootstrap — verify the log line `BootstrapService: bootstrap complete.`); madge
count strictly below the Phase-1 result (the `Database ↔ Security` chain is gone).

- [ ] **Step 10: Verify no other `onModuleInit` depended on seed-on-init ordering**

Run: `grep -rn "onModuleInit" apps/api/src --include=*.module.ts --include=*.service.ts`
Inspect each for an assumption that seed data exists during `onModuleInit`. Seeding now runs on
`onApplicationBootstrap` (strictly _after_ all `onModuleInit`). If any consumer reads seed data in
`onModuleInit`, note it and move that read to `onApplicationBootstrap` in a follow-up step. Expected:
none for current code; record the finding either way.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/bootstrap apps/api/src/database apps/api/src/app.module.ts apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): move startup seeding to root BootstrapModule, make DatabaseModule a leaf"
```

---

## Phase 3 — Extract leaf `AuditModule` (Mechanism C)

Breaks `AuthorizationModule ↔ SecurityModule`.

### Task 3.1: Extract `AuditLogService` into a standalone module

**Files:**

- Create: `apps/api/src/audit/audit.module.ts`
- Create: `apps/api/src/shared/interfaces/audit-log.interface.ts`
- Move: `apps/api/src/security/audit-log.service.ts` → `apps/api/src/audit/audit-log.service.ts` (and its spec, if any)
- Modify: `apps/api/src/security/security.module.ts` (import `AuditModule`; drop the local `AuditLogService` provider/export and `forwardRef(AuthorizationModule)` if it was only for audit)
- Modify: `apps/api/src/auth/authorization/authorization.module.ts` (import `AuditModule`; drop `forwardRef(SecurityModule)`)
- Modify: every importer of `security/audit-log.service` (update import paths)

**Interfaces:**

- Produces: `AuditModule` exports `AuditLogService` and binds `{ provide: AUDIT_LOG_SERVICE, useExisting: AuditLogService }`.
- Consumes: `AuditLogService` (moved verbatim), `AuditLogRepository` (from `DatabaseModule`).

- [ ] **Step 1: Find all consumers of `AuditLogService`**

Run: `grep -rn "audit-log.service" apps/api/src` and `grep -rn "AuditLogService" apps/api/src`
Record the importer list (expected: `SecurityModule`, `AuthorizationAuditService`, possibly others).

- [ ] **Step 2: Write the failing test — `AuditModule` provides the service**

```typescript
import { Test } from "@nestjs/testing";
import { AuditModule } from "./audit.module";
import { AuditLogService } from "./audit-log.service";
import { AUDIT_LOG_SERVICE } from "../shared/interfaces/audit-log.interface";
import { DatabaseModule } from "../database/database.module";

describe("AuditModule", () => {
  it("exports AuditLogService under both the class and the AUDIT_LOG_SERVICE token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuditModule],
    }).compile();

    expect(moduleRef.get(AuditLogService)).toBeDefined();
    expect(moduleRef.get(AUDIT_LOG_SERVICE)).toBe(
      moduleRef.get(AuditLogService),
    );
  });
});
```

- [ ] **Step 3: Run — expect FAIL (AuditModule undefined)**

Run: `npm run test:integration --workspace=apps/api -t "AuditModule"`
Expected: FAIL — cannot find `./audit.module`.

- [ ] **Step 4: Create the interface + token**

```typescript
// apps/api/src/shared/interfaces/audit-log.interface.ts
export const AUDIT_LOG_SERVICE = "AUDIT_LOG_SERVICE";

export interface IAuditLog {
  // Copy the public method signatures of AuditLogService that external
  // consumers (e.g. AuthorizationAuditService) actually call. Fill from the
  // moved service in Step 5 — do not invent methods.
}
```

- [ ] **Step 5: Move the service file**

Move `security/audit-log.service.ts` to `audit/audit-log.service.ts` (use `git mv`). Update its own
relative imports (entity/repository paths). Have the class `implements IAuditLog` and copy its real
public signatures into the interface from Step 4.

- [ ] **Step 6: Create `AuditModule`**

```typescript
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditLogService } from "./audit-log.service";
import { AUDIT_LOG_SERVICE } from "../shared/interfaces/audit-log.interface";

@Module({
  imports: [DatabaseModule],
  providers: [
    AuditLogService,
    { provide: AUDIT_LOG_SERVICE, useExisting: AuditLogService },
  ],
  exports: [AuditLogService, AUDIT_LOG_SERVICE],
})
export class AuditModule {
  protected readonly _moduleName = "AuditModule";
}
```

- [ ] **Step 7: Rewire `SecurityModule`**

In `security.module.ts`: remove `AuditLogService` from `providers`/`exports` and its import; add
`AuditModule` to `imports`; if `forwardRef(() => AuthorizationModule)` existed only so Security could
reach audit, remove it (verify via Step 1's consumer list). Re-export `AuditLogService` only if other
modules import it _from SecurityModule_ — prefer updating those imports to `AuditModule` (no
re-exports per Global Constraints).

- [ ] **Step 8: Rewire `AuthorizationModule`**

In `authorization.module.ts`: remove `forwardRef(() => SecurityModule)`; add `AuditModule` to
`imports`. `AuthorizationAuditService` now resolves `AuditLogService` from `AuditModule`.

- [ ] **Step 9: Update all other importers**

For each importer found in Step 1, change the import path from `../security/audit-log.service` to
`../audit/audit-log.service` (adjust relative depth). No re-exports.

- [ ] **Step 10: Add `AuditModule` to `AppModule`**

In `app.module.ts`, add `AuditModule` to `imports` (so it is instantiated even if only consumed
transitively).

- [ ] **Step 11: Run the test — expect PASS**

Run: `npm run test:integration --workspace=apps/api -t "AuditModule"`
Expected: PASS.

- [ ] **Step 12: Per-change gate**

Run build + `"AppModule boots"` + madge. Expected: all PASS; madge count below Phase-2 result
(`Authorization ↔ Security` chain gone).

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/audit apps/api/src/shared/interfaces/audit-log.interface.ts apps/api/src/security apps/api/src/auth/authorization apps/api/src/app.module.ts apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): extract leaf AuditModule, break Authorization<->Security cycle"
```

---

## Phase 4 — Telemetry event inversion + leaf gateway binding (Mechanism A)

The largest phase. Breaks `Session ↔ Telemetry` and the four `TelemetryModule → Workflow*` edges.
Split into discovery, inbound inversion (telemetry → workflow becomes events), and outbound leaf
extraction (`TELEMETRY_GATEWAY` binding moves to a leaf).

### Task 4.1: Enumerate the telemetry→workflow back-edges

**Files:** none (analysis) — output recorded in `apps/api/CIRCULAR_BASELINE.md` under "Phase 4 surface".

- [ ] **Step 1: List every workflow service the gateway depends on**

From `apps/api/src/telemetry/telemetry.gateway.ts` constructor, the back-edge services are:
`SubagentProvisioningService`, `SubagentCoordinationService` (non-optional);
`QuestionIdleTrackerService`, `WorkflowStepCompletionGuardService`,
`WorkflowRuntimeTerminalRunGuardService`, `WorkflowRunHeartbeatService`,
`ExecutionHeartbeatService` (`@Optional()`). Confirm by reading the constructor.

- [ ] **Step 2: Find every call site of those services inside telemetry**

Run: `grep -rn "subagentProvisioning\|subagentCoordination\|questionIdleTracker\|stepCompletionGuard\|terminalRunGuard\|runHeartbeat\|executionHeartbeat" apps/api/src/telemetry`
Record each call site (gateway + `telemetry-gateway-*.helpers.ts`). Each becomes either (a) an
outbound event the gateway emits, or (b) a service the helper no longer needs. Classify each.

- [ ] **Step 3: Commit the surface map**

```bash
git add apps/api/CIRCULAR_BASELINE.md
git commit -m "docs(api): map telemetry->workflow back-edges for event inversion"
```

### Task 4.2 … 4.k: Convert each inbound back-edge to an event (repeat per service)

> One service per task. Pattern: define a typed event constant + payload, emit it from the gateway/
> helper via the already-injected `EventEmitter2`, add an `@OnEvent` handler in the owning workflow
> service, then delete the injected dependency from the gateway. Example: `WorkflowRunHeartbeatService`.

**Files (per service):**

- Create/Modify: `apps/api/src/workflow/workflow-events.constants.ts` (add event name) and a payload type in `apps/api/src/workflow/workflow-events.types.ts`
- Modify: the owning workflow service (add `@OnEvent` handler)
- Modify: `apps/api/src/telemetry/telemetry.gateway.ts` and relevant `telemetry-gateway-*.helpers.ts` (emit event; drop injected service)

**Interfaces:**

- Produces: event constant (e.g. `WORKFLOW_RUN_HEARTBEAT_EVENT`) + payload type consumed by the workflow `@OnEvent` handler. Uses existing `EventEmitter2` already injected into `TelemetryGateway`.

- [ ] **Step 1: Write the failing test — workflow service reacts to the event**

```typescript
// in the owning workflow service's spec
it("records a run heartbeat when the telemetry heartbeat event fires", async () => {
  const recordSpy = vi.spyOn(service, "recordHeartbeat"); // real method name from the service
  await service.onTelemetryHeartbeat({
    workflowRunId: "run-1",
    stepId: "step-1",
  });
  expect(recordSpy).toHaveBeenCalledWith("run-1", "step-1");
});
```

- [ ] **Step 2: Run — expect FAIL (handler method does not exist)**

Run: `npm run test --workspace=apps/api -t "records a run heartbeat"`
Expected: FAIL.

- [ ] **Step 3: Add the event constant + payload type**

```typescript
// workflow-events.constants.ts
export const WORKFLOW_RUN_HEARTBEAT_EVENT = "workflow.run.heartbeat";
```

```typescript
// workflow-events.types.ts
export interface WorkflowRunHeartbeatEvent {
  workflowRunId: string;
  stepId?: string;
}
```

- [ ] **Step 4: Add the `@OnEvent` handler in the workflow service**

```typescript
@OnEvent(WORKFLOW_RUN_HEARTBEAT_EVENT)
async onTelemetryHeartbeat(payload: WorkflowRunHeartbeatEvent): Promise<void> {
  await this.recordHeartbeat(payload.workflowRunId, payload.stepId); // real method
}
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npm run test --workspace=apps/api -t "records a run heartbeat"`
Expected: PASS.

- [ ] **Step 6: Emit from the gateway/helpers; delete the injected dependency**

Replace each call site (from Task 4.1 Step 2) `this.runHeartbeat?.recordHeartbeat(a, b)` with
`this.eventEmitter?.emit(WORKFLOW_RUN_HEARTBEAT_EVENT, { workflowRunId: a, stepId: b })`. Remove the
`runHeartbeat` constructor parameter and its warning block. Update helper signatures to drop the
passed-in service and accept the emitter where needed.

- [ ] **Step 7: Per-change gate**

Build + `"AppModule boots"` + madge. Expected: PASS; functional parity verified by the workflow
service spec.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workflow apps/api/src/telemetry
git commit -m "refactor(api): invert telemetry run-heartbeat back-edge to event"
```

### Task 4.k+1: Extract leaf `TELEMETRY_GATEWAY` binding and remove `forwardRef(Workflow*)`

**Files:**

- Modify: `apps/api/src/telemetry/telemetry.module.ts` (remove all four `forwardRef(Workflow*)` imports once Task 4.2…4.k removed the back-edges)
- Modify: `apps/api/src/session/session.module.ts` (`forwardRef(() => TelemetryModule)` → plain import, or import the leaf gateway-provider module)

- [ ] **Step 1: Remove workflow imports from `telemetry.module.ts`**

After every back-edge is an event (no workflow service injected by `TelemetryGateway`), delete
`forwardRef(() => WorkflowCoreModule)`, `forwardRef(() => WorkflowRuntimeModule)`,
`forwardRef(() => WorkflowRunOperationsModule)`, `forwardRef(() => WorkflowSubagentsModule)` and their
`import` lines.

- [ ] **Step 2: De-`forwardRef` the Session↔Telemetry edge**

In `session.module.ts`, change `forwardRef(() => TelemetryModule)` to `TelemetryModule` (Session needs
only `TELEMETRY_GATEWAY`, which Telemetry now provides as a leaf w.r.t. workflow). Drop `forwardRef`
from the import if unused.

- [ ] **Step 3: Per-change gate**

Build + `"AppModule boots"` + madge. Expected: PASS; madge count drops by the telemetry cluster
(≥5 chains). If boot fails, a back-edge was missed — return to Task 4.2 for the offending service.

- [ ] **Step 4: Promote `@Optional()` injections to required where safe**

For any workflow→telemetry consumer whose `@Inject(TELEMETRY_GATEWAY)` was `@Optional()` only to
satisfy the old cycle, remove `@Optional()` so a missing gateway fails at boot. Verify with the boot
test. (Do this conservatively — keep `@Optional()` where the service legitimately runs without a
gateway, e.g. in unit construction.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/telemetry/telemetry.module.ts apps/api/src/session/session.module.ts apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): drop forwardRef telemetry<->workflow and session<->telemetry cycles"
```

---

## Phase 5 — Memory / Learning / Session / BuiltInContext cluster

Breaks `Memory ↔ Learning` and `Session ↔ Memory ↔ BuiltInMemoryContextProviders`.

### Task 5.1: Invert `Memory ↔ Learning` via interface for the promotion back-edge

**Files:**

- Create: `apps/api/src/shared/interfaces/memory-promotion.interface.ts` (`MEMORY_READER` token + interface covering the `MemoryManagerService`/`MemoryMetricsService` methods `LearningPromotionService` calls)
- Modify: `apps/api/src/memory/learning/learning.module.ts` (drop `forwardRef(() => MemoryModule)`; depend on the token via a leaf or via `MemoryModule` plain import once Memory no longer imports Learning)
- Modify: `apps/api/src/memory/memory.module.ts` (resolve how Learning is consumed — see Step 1)

- [ ] **Step 1: Determine the true direction**

Read `memory.module.ts` and `learning.module.ts`: confirm `LearningPromotionService` needs
`MemoryManagerService` + `MemoryMetricsService`, and identify what `MemoryModule` needs from
`LearningModule` (per the inventory: it imports `forwardRef(LearningModule)` to export
`LearningPromotionService`). If `MemoryModule` only _re-exports_ Learning providers, have consumers
import `LearningModule` directly and drop the Memory→Learning import entirely (one-directional → plain
import). Record the decision.

- [ ] **Step 2: Write the failing test**

Construct `LearningModule` (with `MemoryModule` imported plainly, or the `MEMORY_READER` token
provided) in a `Test.createTestingModule` and assert `LearningPromotionService` resolves. Run, expect
FAIL if the cycle still forces `forwardRef`.

- [ ] **Step 3: Apply the chosen inversion**

Either (a) delete the `Memory → Learning` import and update consumers to import `LearningModule`, or
(b) introduce `MEMORY_READER` (interface in `shared/interfaces`, bound in `MemoryModule`,
`LearningPromotionService` injects the token) so `LearningModule` no longer imports `MemoryModule`'s
concrete classes.

- [ ] **Step 4: Run test — expect PASS.** Run: `npm run test:integration --workspace=apps/api -t "LearningModule"`.

- [ ] **Step 5: Per-change gate** (build + boot + madge).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory apps/api/src/shared/interfaces/memory-promotion.interface.ts apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): break Memory<->Learning cycle via interface inversion"
```

### Task 5.2: Break `Session ↔ Memory ↔ BuiltInMemoryContextProviders` via bootstrap registration

**Files:**

- Modify: `apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.ts` (drop `forwardRef(() => SessionModule)`)
- Modify: `apps/api/src/memory/built-in-context-providers/*registrar*.ts` (resolve `ChatSessionContextService` lazily via `ModuleRef` at `OnApplicationBootstrap`, OR have `SessionModule` register providers by importing the leaf provider list — choose per Step 1)
- Modify: `apps/api/src/session/session.module.ts` and/or `apps/api/src/memory/memory.module.ts`

- [ ] **Step 1: Inspect the registration direction**

The `BuiltInContextProviderRegistrar` already registers itself with `ChatSessionContextService` on
`OnApplicationBootstrap`. Decide: invert so `ChatSessionContextService` _pulls_ registered providers
(provider modules depend on a registry token, not on `SessionModule`), removing the
`BuiltInContextProviders → Session` import. Record the approach.

- [ ] **Step 2: Write the failing test**

Assert the built-in providers are registered with `ChatSessionContextService` after `app.init()`
without `BuiltInMemoryContextProvidersModule` importing `SessionModule`. Run, expect FAIL.

- [ ] **Step 3: Implement the inversion** (registry token in `shared/interfaces`, providers self-register via the token; or `ModuleRef.get(ChatSessionContextService, { strict: false })` at bootstrap).

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: Per-change gate** (build + boot + madge). Verify provider registration still occurs (assert a known built-in provider is present).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory apps/api/src/session apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): break Session<->Memory<->BuiltInContext cycle via registry inversion"
```

---

## Phase 6 — Local service cycles (Mechanism E)

### Task 6.1: Extract `SpecialStepRegistry` leaf to break `WorkflowCore ↔ WorkflowSpecialSteps`

**Files:**

- Create: `apps/api/src/workflow/workflow-special-steps/special-step-registry.module.ts` (leaf exporting `StepSpecialStepRegistryService`)
- Modify: `apps/api/src/workflow/workflow-special-steps/workflow-special-steps.module.ts` (consume the leaf; keep the executor which needs `WORKFLOW_ENGINE_SERVICE`)
- Modify: `apps/api/src/workflow/workflow-core.module.ts` (import the registry leaf for `WorkflowValidationService`; drop `forwardRef(() => WorkflowSpecialStepsModule)`)

**Interfaces:**

- Produces: a leaf module exporting `StepSpecialStepRegistryService` (the read-only step-type registry) imported by both Core-validation and Special-steps.

- [ ] **Step 1: Confirm the registry has no upward dependency**

Read `StepSpecialStepRegistryService`: confirm it does not depend on `WORKFLOW_ENGINE_SERVICE` or any
Core/StepExecution provider (only holds/looks up step types). If it does, that dependency must move to
the executor first. Record findings.

- [ ] **Step 2: Write the failing test**

Construct the new `SpecialStepRegistryModule` alone in `Test.createTestingModule` and assert
`StepSpecialStepRegistryService` resolves with no other workflow module imported. Run, expect FAIL.

- [ ] **Step 3: Create the leaf module** exporting `StepSpecialStepRegistryService` (move the provider out of `WorkflowSpecialStepsModule` into the leaf; `WorkflowSpecialStepsModule` imports the leaf).

- [ ] **Step 4: Rewire `WorkflowCoreModule`** to import the registry leaf instead of `forwardRef(() => WorkflowSpecialStepsModule)`; `WorkflowValidationService` now gets the registry from the leaf.

- [ ] **Step 5: Run test — expect PASS.**

- [ ] **Step 6: Per-change gate** (build + boot + madge — the Core↔SpecialSteps chain should disappear).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-special-steps apps/api/src/workflow/workflow-core.module.ts apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): extract SpecialStepRegistry leaf, break Core<->SpecialSteps cycle"
```

### Task 6.2: Resolve `WorkflowRuntimeCapabilityExecutorService ↔ WorkflowRuntimeToolsService`

**Files:**

- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.ts`, `.../workflow-runtime-tools.service.ts`, `.../workflow-runtime.module.ts`

- [ ] **Step 1: Identify the narrow slice**

Read both services. The executor injects `forwardRef(WorkflowRuntimeToolsService)`; tools injects
`WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE`. Determine which direction needs only a small,
stable slice (likely tools→executor: "execute this capability"). Record it.

- [ ] **Step 2: Write the failing test** asserting both resolve without `forwardRef` once the slice is a token interface. Run, expect FAIL.

- [ ] **Step 3: Extract the narrow interface + token** into `shared/interfaces/`, bind it to the executor, and have `WorkflowRuntimeToolsService` depend on the token. Remove the service-level `forwardRef`. If extraction is disproportionate, document this single edge as an **accepted intra-module service cycle** in `CIRCULAR_BASELINE.md` and keep the `forwardRef` (it is service-scoped, not module-scoped, so blast radius is minimal).

- [ ] **Step 4: Run test — expect PASS** (or, if accepted, record the exception).

- [ ] **Step 5: Per-change gate** (build + boot + madge).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime apps/api/CIRCULAR_BASELINE.md
git commit -m "refactor(api): break runtime capability-executor<->tools cycle via capability token"
```

---

## Phase 7 — Lock it in (CI gate + ADR + docs)

### Task 7.1: Add a CI gate that fails on new circular dependencies

**Files:**

- Modify: `apps/api/package.json` (add `madge:ci` script comparing against the ratcheted baseline)
- Create: `apps/api/scripts/check-circular.mjs` (fails non-zero if circular count > baseline integer)
- Modify: the repo CI workflow under `.github/workflows/` (invoke `npm run madge:ci --workspace=apps/api`)

- [ ] **Step 1: Write the failing test for the checker**

Add a unit test for `check-circular.mjs` that feeds it a count above and below the baseline and asserts
exit code 1 and 0 respectively (extract the comparison into a pure function imported by the test). Run,
expect FAIL.

- [ ] **Step 2: Implement `check-circular.mjs`** — parse `madge --circular --json src`, compare the chain count to the integer in `CIRCULAR_BASELINE.md`, exit 1 if greater, print the new chains.

- [ ] **Step 3: Run the test — expect PASS.**

- [ ] **Step 4: Wire `madge:ci` into the API CI job.** Add the script and the CI step. Set the baseline integer to the **post-Phase-6** count (the new floor).

- [ ] **Step 5: Per-change gate + run `madge:ci` locally** — expect exit 0 at the current count.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/scripts/check-circular.mjs apps/api/CIRCULAR_BASELINE.md .github/workflows
git commit -m "ci(api): gate against new circular dependencies"
```

### Task 7.2: Record the ADR and update docs

**Files:**

- Create: `docs/architecture/ADR-<n>-api-module-dependency-inversion.md`
- Modify: `docs/guide/README.md` (link the ADR + the leaf-module/composition-root conventions)

- [ ] **Step 1: Write the ADR** — context (forwardRef sprawl), decision (five mechanisms, leaf modules, `BootstrapModule`, `AuditModule`, event inversion, no `@Global()`/allowlists), consequences, and the accepted-exception list (any remaining service-scoped `forwardRef`).

- [ ] **Step 2: Link from the guide** — add a short "Module dependency conventions" subsection in `docs/guide/README.md` pointing at the ADR and the `madge:ci` gate.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture docs/guide/README.md
git commit -m "docs(api): ADR for module dependency inversion + forwardRef policy"
```

---

## Self-Review Notes

- **Spec coverage:** Each design-doc cycle (1–7) maps to a phase — 1–2 → Phase 4; 3 → Phase 2;
  4 → Phase 3; 5–6 → Phase 5; 7 → Phase 6; R4 defensive edges → Phase 1; enforcement → Phase 7.
- **Discovery steps are real actions, not placeholders:** Phases 1, 4, 5, 6 begin with enumeration
  because the exact per-call-site edits depend on a surface that must be measured first; the _pattern_
  and _gate_ for each are fully specified.
- **Sequencing:** Phase 0 must precede all others (provides the gate). Phases 2, 3, 6 are independent
  and may run in any order / in parallel worktrees. Phase 4 is largest — schedule after the cheap wins.
  Phase 5 is independent of 2/3/4. Phase 7 runs last (sets the final ratchet).
- **Verification source of truth:** NestJS boot (`"AppModule boots"`) is authoritative for whether a
  `forwardRef` was removable; `madge` is the tracking metric and CI ratchet, never the sole judge.
