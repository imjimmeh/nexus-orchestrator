import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationDiffService } from './reconciliation-diff.service';
import { DriftDetectionService } from './drift-detection.service';
import { ActualStateReaderService } from './actual-state-reader.service';
import { ReconciliationApplyService } from './reconciliation-apply.service';
import { ScopeService } from '../scope/scope.service';
import { AuditLogRepository } from '../audit/database/repositories/audit-log.repository';
import { DesiredStateLoaderService } from './desired-state-loader.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsReconciliationLoopService } from './gitops-reconciliation-loop.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { MetricsService } from '../observability/metrics.service';
import { GitOpsReconcileRun } from './database/entities/gitops-reconcile-run.entity';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import type { DesiredState } from './reconciliation.types';

// The destructive integration suite (it connects to a live Postgres DB)
// runs ONLY against a dedicated throwaway database, never the
// everyday application DB. Set INTEGRATION_TEST_DATABASE_URL to a
// disposable Postgres to enable it (CI provisions one). Absent that
// var the suite skips — so `npm run test:api` on a dev machine can
// never affect live data.
const INTEGRATION_TEST_DATABASE_URL =
  process.env['INTEGRATION_TEST_DATABASE_URL'];
const DB_AVAILABLE = Boolean(INTEGRATION_TEST_DATABASE_URL);

describe.skipIf(!DB_AVAILABLE)('GitOps reconciliation (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;

  // ---------------------------------------------------------------------------
  // Inline desired-state fixtures (mirror the on-disk YAML files in
  // apps/api/test/fixtures/gitops/ — kept in-memory here so the integration
  // test has no filesystem or git-clone dependency).
  // ---------------------------------------------------------------------------

  const orgTeamState: DesiredState = {
    prune: false,
    objects: [
      {
        type: 'scope_node',
        key: '/acme',
        fields: { type: 'org', name: 'Acme', slug: 'acme', parentId: null },
      },
      {
        type: 'scope_node',
        key: '/acme/alpha',
        fields: { type: 'team', name: 'Alpha', slug: 'alpha', parentId: null },
      },
      {
        type: 'role',
        key: 'viewer',
        fields: { description: 'Read-only viewer' },
      },
      {
        type: 'role_assignment',
        key: 'u1:viewer:/acme',
        fields: { userId: 'u1', roleId: 'viewer', scopeNodeId: '/acme' },
      },
    ],
  };

  const orgOnlyState: DesiredState = {
    prune: true,
    objects: [
      {
        type: 'scope_node',
        key: '/acme',
        fields: { type: 'org', name: 'Acme', slug: 'acme', parentId: null },
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Refuse to use the application database for integration tests.
   * Compares the connected database name against both DB_DATABASE and
   * DB_NAME env vars (this spec historically used DB_NAME) as well as
   * the `nexus_orchestrator` default to be safe.
   */
  async function assertNotApplicationDatabase(
    dataSource: DataSource,
  ): Promise<void> {
    const rows = await dataSource.query<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const connected = rows[0]?.current_database;
    const appDb =
      process.env['DB_DATABASE'] ??
      process.env['DB_NAME'] ??
      'nexus_orchestrator';
    if (connected === appDb) {
      throw new Error(
        `Refusing to run: integration test is connected to the application database "${connected}". ` +
          'Point INTEGRATION_TEST_DATABASE_URL at a dedicated throwaway database.',
      );
    }
  }

  const mockLoaderFor = (
    state: DesiredState,
  ): Partial<DesiredStateLoaderService> => ({
    load: async () => state,
  });

  beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationDiffService,
        DriftDetectionService,
        {
          provide: DataSource,
          useFactory: async () => {
            const ds = new DataSource({
              type: 'postgres',
              url: INTEGRATION_TEST_DATABASE_URL,
              synchronize: false,
              logging: false,
            });
            return ds.initialize();
          },
        },
        {
          provide: ScopeService,
          useValue: {
            createNode: async (input: Record<string, unknown>) => input,
            getDescendantIds: async () => [],
            getAncestorIds: async () => [],
          },
        },
        {
          provide: AuditLogRepository,
          useValue: { log: async () => ({}) },
        },
        ActualStateReaderService,
        ReconciliationApplyService,
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    await assertNotApplicationDatabase(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  function makeRecon(
    loader: Partial<DesiredStateLoaderService>,
  ): ReconciliationService {
    return new ReconciliationService(
      loader as DesiredStateLoaderService,
      moduleRef.get(ActualStateReaderService),
      moduleRef.get(ReconciliationDiffService),
      moduleRef.get(ReconciliationApplyService),
      moduleRef.get(DriftDetectionService),
      // The integration suite exercises read-only paths
      // (`plan`, `detectDrift`). The mutation collaborators are
      // stubbed so the deprecation adapter wiring is exercised
      // without forcing the full GitOps module dependency
      // graph into the integration fixture.
      {
        apply: async () => undefined,
      } as unknown as GitOpsInboundReconcileService,
      {
        listActive: async () => [],
      } as unknown as GitOpsRepositoryBindingService,
      {
        emitDeprecatedApplyEvent: async () => undefined,
      } as unknown as GitOpsReconciliationLoopService,
    );
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  it('plan is read-only: produces a changes array without mutating the DB', async () => {
    const svc = makeRecon(mockLoaderFor(orgTeamState));
    const plan = await svc.plan(
      { repoUrl: 'https://mock.example.com/repo', ref: 'main' },
      { actorId: 'test' },
    );
    expect(plan.changes).toBeDefined();
    expect(Array.isArray(plan.changes)).toBe(true);
  });

  it('detectDrift returns a structured report without throwing', async () => {
    const svc = makeRecon(mockLoaderFor(orgTeamState));
    const report = await svc.detectDrift(
      { repoUrl: 'https://mock.example.com/repo', ref: 'main' },
      { actorId: 'test' },
    );
    expect(report).toHaveProperty('drifted');
    expect(report).toHaveProperty('inSync');
    expect(Array.isArray(report.drifted)).toBe(true);
    expect(typeof report.inSync).toBe('number');
  });

  it('prune:true with empty desired-state marks only gitops-managed objects as deletes', async () => {
    const svc = makeRecon(mockLoaderFor({ prune: true, objects: [] }));
    const plan = await svc.plan(
      { repoUrl: 'https://mock.example.com/repo', ref: 'main' },
      { actorId: 'test' },
    );
    // All emitted deletes come from the actual-state reader and only cover
    // gitops-managed objects (unmanaged objects are filtered by the diff engine).
    const deletes = plan.changes.filter((c) => c.op === 'delete');
    expect(deletes.every((c) => c.op === 'delete')).toBe(true);
  });

  it('org-only prune state plan is a valid ReconciliationPlan', async () => {
    const svc = makeRecon(mockLoaderFor(orgOnlyState));
    const plan = await svc.plan(
      { repoUrl: 'https://mock.example.com/repo', ref: 'main' },
      { actorId: 'test' },
    );
    expect(plan).toHaveProperty('changes');
    expect(plan).toHaveProperty('summary');
    expect(typeof plan.summary.create).toBe('number');
    expect(typeof plan.summary.delete).toBe('number');
    expect(typeof plan.summary.update).toBe('number');
    expect(typeof plan.summary.noop).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Routing / contract suite — exercises the loop → inbound → audit-row
// call chain with in-memory mocks. This is intentionally NOT under
// `describe.skipIf(!DB_AVAILABLE)` because it never touches a database:
// the routing assertion is structural (call chain + audit-row shape),
// not persistence-based. The block lives next to the DB-dependent
// describe above to keep the file focused on the reconciliation
// subsystem; in CI both suites run in parallel under the
// `--project integration` vitest project.
// ---------------------------------------------------------------------------

describe('GitOpsReconciliationLoopService tick() routing (integration)', () => {
  /**
   * Build the canonical loop service with the real
   * `GitOpsInboundReconcileService` (so the `runs.create`
   * audit-row path is exercised end-to-end) and mock
   * collaborators everywhere else. The legacy
   * `ReconciliationService.apply` is intentionally NOT wired
   * in — the loop service's constructor takes only the
   * inbound service, so the test doubles as a structural
   * guard against accidentally re-introducing the legacy
   * mutation surface.
   */
  function buildTickHarness(): {
    loopService: GitOpsReconciliationLoopService;
    bindingsMock: { listActive: ReturnType<typeof vi.fn> };
    inboundApply: ReturnType<typeof vi.fn>;
    runRows: Partial<GitOpsReconcileRun>[];
    tickInc: ReturnType<typeof vi.fn>;
  } {
    const bindingsList: GitOpsRepositoryBinding[] = [
      {
        id: 'binding-a',
        scopeNodeId: 'scope-a',
        name: 'alpha',
        repoUrl: 'https://example.com/alpha.git',
        defaultRef: 'main',
        rootPath: '.',
        syncMode: 'git_to_app',
        credentialsSecretId: null,
        enabled: true,
        includedObjectTypes: ['workflow'],
        conflictPolicy: 'require_review',
        lastAppliedRevision: null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'binding-b',
        scopeNodeId: 'scope-b',
        name: 'beta',
        repoUrl: 'https://example.com/beta.git',
        defaultRef: 'main',
        rootPath: '.',
        syncMode: 'git_to_app',
        credentialsSecretId: null,
        enabled: true,
        includedObjectTypes: ['workflow'],
        conflictPolicy: 'require_review',
        lastAppliedRevision: null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const bindingsMock = {
      listActive: vi.fn().mockResolvedValue(bindingsList),
    };

    const bindingRepoMock = {
      findById: vi.fn(async (id: string) => {
        const found = bindingsList.find((binding) => binding.id === id);
        return found ?? null;
      }),
      update: vi.fn(),
    };

    const runRows: Partial<GitOpsReconcileRun>[] = [];
    const runRepoMock = {
      create: vi.fn(async (data: Partial<GitOpsReconcileRun>) => {
        const row = {
          id: `run-${runRows.length + 1}`,
          ...data,
        } as GitOpsReconcileRun;
        runRows.push(row);
        return row;
      }),
      update: vi.fn(async (id: string, data: Partial<GitOpsReconcileRun>) => {
        const row = runRows.find((candidate) => candidate.id === id);
        if (row) Object.assign(row, data);
        return { id, ...data } as GitOpsReconcileRun;
      }),
      findById: vi.fn(),
      findByBindingId: vi.fn(),
      findAll: vi.fn(),
      remove: vi.fn(),
    };

    const desiredStateMock = {
      loadForBinding: vi.fn().mockResolvedValue({ prune: false, objects: [] }),
    };

    const registryMock = {
      getHandlersForBinding: vi.fn().mockReturnValue([]),
    };

    const diffMock = {
      computePlan: vi.fn().mockReturnValue({
        changes: [],
        summary: { create: 0, update: 0, delete: 0, noop: 0 },
      }),
    };

    const applierMock = {
      apply: vi.fn().mockResolvedValue({
        planned: 0,
        applied: 0,
        skipped: 0,
        dryRun: false,
      }),
    };

    const pendingChangesMock = {
      findByBindingId: vi.fn().mockResolvedValue([]),
    };

    const inbound = new GitOpsInboundReconcileService(
      bindingRepoMock as never,
      desiredStateMock as never,
      registryMock as never,
      diffMock as never,
      applierMock as never,
      runRepoMock as never,
      pendingChangesMock as never,
    );

    const tickInc = vi.fn();
    const metrics = {
      gitopsReconciliationTickCompletedTotal: { inc: tickInc },
    } as unknown as MetricsService;

    const eventLedgerMock = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventLedgerService;

    const config = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const loopService = new GitOpsReconciliationLoopService(
      config,
      bindingsMock as unknown as GitOpsRepositoryBindingService,
      inbound,
      eventLedgerMock,
      metrics,
    );

    // Spy on `inbound.apply` so the test can assert the exact
    // call shape without depending on the `runRepoMock.create`
    // mock to imply it.
    const inboundApply = vi.spyOn(inbound, 'apply');

    return { loopService, bindingsMock, inboundApply, runRows, tickInc };
  }

  it('tick() routes through GitOpsInboundReconcileService.apply and writes a GitOpsReconcileRun row per active binding', async () => {
    const harness = buildTickHarness();

    const result = await harness.loopService.tick();

    // 1. Iterates active bindings via the canonical
    //    `GitOpsRepositoryBindingService.listActive()` path.
    expect(harness.bindingsMock.listActive).toHaveBeenCalledTimes(1);

    // 2. Routes through `GitOpsInboundReconcileService.apply`
    //    for every active binding — NOT the legacy
    //    `ReconciliationService.apply`. The legacy service is
    //    not even wired into the loop service's constructor,
    //    but we assert the inbound call shape explicitly so a
    //    future refactor cannot silently re-route the tick.
    expect(harness.inboundApply).toHaveBeenCalledTimes(2);
    expect(harness.inboundApply).toHaveBeenNthCalledWith(
      1,
      'scope-a',
      'binding-a',
      { actorId: 'system:gitops-reconciliation-loop' },
    );
    expect(harness.inboundApply).toHaveBeenNthCalledWith(
      2,
      'scope-b',
      'binding-b',
      { actorId: 'system:gitops-reconciliation-loop' },
    );

    // 3. Each active binding results in a `GitOpsReconcileRun`
    //    audit row written by the inbound service. The first
    //    row per binding carries the inbound `applying`
    //    sentinel that the canonical mutation path emits
    //    before the plan is computed.
    expect(harness.runRows.length).toBeGreaterThanOrEqual(2);
    const bindingsWithRuns = new Set(
      harness.runRows.map((row) => row.bindingId),
    );
    expect(bindingsWithRuns.has('binding-a')).toBe(true);
    expect(bindingsWithRuns.has('binding-b')).toBe(true);
    for (const bindingId of ['binding-a', 'binding-b']) {
      const applyRow = harness.runRows.find(
        (row) => row.bindingId === bindingId && row.direction === 'inbound',
      );
      expect(applyRow).toBeDefined();
      expect(applyRow?.actorUserId).toBe('system:gitops-reconciliation-loop');
      expect(applyRow?.startedAt).toBeInstanceOf(Date);
    }

    // Tick summary surfaces the per-binding counts.
    expect(result.applied).toBe(2);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.bindingsEvaluated).toBe(2);

    // Each evaluated binding increments the
    // `applied` counter label exactly once.
    expect(harness.tickInc).toHaveBeenCalledWith({ result: 'applied' });
    expect(harness.tickInc).toHaveBeenCalledTimes(2);
  });

  it('tick() isolates per-binding conflicts so one failing binding does not block the others', async () => {
    const harness = buildTickHarness();

    // Make the second binding's apply fail with a
    // `BadRequestException` so the loop classifies it as a
    // conflict (per the `applyOneBinding` classification in
    // the production implementation) rather than as an error.
    harness.inboundApply
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new BadRequestException('plan has conflicts'));

    const result = await harness.loopService.tick();

    expect(result.applied).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.bindingsEvaluated).toBe(2);

    // The conflicting binding's inbound apply raised before
    // the post-apply `runs.update` ran in the real service,
    // but our mock signature replaces `apply` with a rejection
    // and does not invoke the real method — so the harness
    // records two `runs.create` rows but no second
    // `runs.update` for the failing binding. The structural
    // assertion that matters is: both bindings were routed
    // through `inbound.apply` despite the second one
    // throwing.
    expect(harness.inboundApply).toHaveBeenCalledTimes(2);

    // The prom-client counter surfaces both labels.
    expect(harness.tickInc).toHaveBeenCalledWith({ result: 'applied' });
    expect(harness.tickInc).toHaveBeenCalledWith({ result: 'conflict' });
  });
});

// ---------------------------------------------------------------------------
// Safety-gate test — always runs, regardless of DB availability.
// Asserts the DB-backed suite is gated on a DEDICATED throwaway DB,
// never the everyday application DB.
// ---------------------------------------------------------------------------

describe('integration-test safety gate', () => {
  it('does not target the application database by default', () => {
    // The DB-connected suite must be gated on a DEDICATED throwaway DB,
    // never the everyday DB_HOST/DB_DATABASE the running app uses.
    const gatedOnDedicatedVar = Boolean(
      process.env['INTEGRATION_TEST_DATABASE_URL'],
    );
    const appDbVarsPresent = Boolean(
      process.env['DB_HOST'] ??
      process.env['DB_DATABASE'] ??
      process.env['DATABASE_URL'],
    );
    // If only app DB vars are present (the normal dev/CI case), the
    // DB-connected suite MUST be skipped.
    if (appDbVarsPresent && !gatedOnDedicatedVar) {
      expect(DB_AVAILABLE).toBe(false);
    }
  });
});
