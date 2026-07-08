import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitOpsReconciliationLoopService } from './gitops-reconciliation-loop.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { MetricsService } from '../observability/metrics.service';

interface BindingsStub {
  listActive: ReturnType<typeof vi.fn>;
}

interface InboundStub {
  apply: ReturnType<typeof vi.fn>;
}

interface EventLedgerStub {
  emitBestEffort: ReturnType<typeof vi.fn>;
}

interface MetricsStub {
  gitopsReconciliationTickCompletedTotal: { inc: ReturnType<typeof vi.fn> };
}

describe('GitOpsReconciliationLoopService', () => {
  let bindings: BindingsStub;
  let inbound: InboundStub;
  let eventLedger: EventLedgerStub;
  let metrics: MetricsStub;
  let configGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    bindings = { listActive: vi.fn() };
    inbound = { apply: vi.fn() };
    eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
    metrics = {
      gitopsReconciliationTickCompletedTotal: { inc: vi.fn() },
    };
    configGet = vi.fn();
  });

  async function buildService(): Promise<GitOpsReconciliationLoopService> {
    const mod = await Test.createTestingModule({
      providers: [
        GitOpsReconciliationLoopService,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
        {
          provide: GitOpsRepositoryBindingService,
          useValue: bindings,
        },
        {
          provide: GitOpsInboundReconcileService,
          useValue: inbound,
        },
        {
          provide: EventLedgerService,
          useValue: eventLedger,
        },
        {
          provide: MetricsService,
          useValue: metrics,
        },
      ],
    }).compile();
    return mod.get(GitOpsReconciliationLoopService);
  }

  it('is a no-op and emits no events when the loop is disabled', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'GITOPS_RECONCILIATION_ENABLED') return 'false';
      return undefined;
    });
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-1', enabled: true },
    ]);

    const svc = await buildService();
    const result = await svc.tick();

    expect(result).toMatchObject({
      applied: 0,
      conflicts: 0,
      errors: 0,
      bindingsEvaluated: 0,
    });
    expect(inbound.apply).not.toHaveBeenCalled();
    expect(
      metrics.gitopsReconciliationTickCompletedTotal.inc,
    ).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('iterates active bindings in id-ascending order and counts applied', async () => {
    configGet.mockReturnValue(undefined);
    bindings.listActive.mockResolvedValue([
      { id: 'binding-a', scopeNodeId: 'scope-a', enabled: true },
      { id: 'binding-b', scopeNodeId: 'scope-b', enabled: true },
    ]);
    inbound.apply.mockResolvedValue(undefined);

    const svc = await buildService();
    const result = await svc.tick();

    expect(inbound.apply).toHaveBeenCalledTimes(2);
    const callOrder = inbound.apply.mock.calls.map(
      (call) => (call[1] as string) ?? '',
    );
    // `listActive` is responsible for returning bindings in
    // deterministic id-ascending order. The loop iterates in
    // the order it receives them; the fixture mirrors the
    // binding service's contract.
    expect(callOrder).toEqual(['binding-a', 'binding-b']);
    expect(result.applied).toBe(2);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.bindingsEvaluated).toBe(2);
    expect(
      metrics.gitopsReconciliationTickCompletedTotal.inc,
    ).toHaveBeenCalledWith({ result: 'applied' });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'gitops',
        eventName: 'gitops.reconciliation.tick_completed',
      }),
    );
  });

  it('isolates per-binding conflicts and errors', async () => {
    configGet.mockReturnValue(undefined);
    bindings.listActive.mockResolvedValue([
      { id: 'binding-a', scopeNodeId: 'scope-a', enabled: true },
      { id: 'binding-b', scopeNodeId: 'scope-b', enabled: true },
      { id: 'binding-c', scopeNodeId: 'scope-c', enabled: true },
    ]);
    inbound.apply
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new BadRequestException('plan has conflicts'))
      .mockRejectedValueOnce(new Error('db down'));

    const svc = await buildService();
    const result = await svc.tick();

    expect(result.applied).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.bindingsEvaluated).toBe(3);
    expect(
      metrics.gitopsReconciliationTickCompletedTotal.inc,
    ).toHaveBeenCalledWith({ result: 'applied' });
    expect(
      metrics.gitopsReconciliationTickCompletedTotal.inc,
    ).toHaveBeenCalledWith({ result: 'conflict' });
    expect(
      metrics.gitopsReconciliationTickCompletedTotal.inc,
    ).toHaveBeenCalledWith({ result: 'error' });
  });

  it('passes binding.scopeNodeId and a system actor to inbound.apply', async () => {
    configGet.mockReturnValue(undefined);
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-7', enabled: true },
    ]);
    inbound.apply.mockResolvedValue(undefined);

    const svc = await buildService();
    await svc.tick();

    expect(inbound.apply).toHaveBeenCalledWith('scope-7', 'binding-1', {
      actorId: 'system:gitops-reconciliation-loop',
    });
  });

  it('emits the tick_completed event with the contract-shaped payload', async () => {
    configGet.mockReturnValue(undefined);
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-1', enabled: true },
    ]);
    inbound.apply.mockResolvedValue(undefined);

    const svc = await buildService();
    await svc.tick();

    const tickCall = eventLedger.emitBestEffort.mock.calls.find(
      (call) =>
        (call[0] as { eventName?: string }).eventName ===
        'gitops.reconciliation.tick_completed',
    );
    expect(tickCall).toBeDefined();
    const params = tickCall?.[0] as {
      outcome: string;
      payload: Record<string, unknown>;
    };
    expect(params.outcome).toBe('success');
    expect(params.payload).toMatchObject({
      applied: 1,
      conflicts: 0,
      errors: 0,
      bindingsEvaluated: 1,
    });
    expect(typeof params.payload['emittedAt']).toBe('string');
    expect(typeof params.payload['durationMs']).toBe('number');
  });

  it('emits tick_completed with failure outcome when any binding errored', async () => {
    configGet.mockReturnValue(undefined);
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-1', enabled: true },
    ]);
    inbound.apply.mockRejectedValue(new Error('db down'));

    const svc = await buildService();
    await svc.tick();

    const tickCall = eventLedger.emitBestEffort.mock.calls.find(
      (call) =>
        (call[0] as { eventName?: string }).eventName ===
        'gitops.reconciliation.tick_completed',
    );
    const params = tickCall?.[0] as { outcome: string };
    expect(params.outcome).toBe('failure');
  });

  it('honors GITOPS_RECONCILIATION_ENABLED=false (off, 0, false)', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'GITOPS_RECONCILIATION_ENABLED') return 'off';
      return undefined;
    });
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-1', enabled: true },
    ]);

    const svc = await buildService();
    const result = await svc.tick();

    expect(inbound.apply).not.toHaveBeenCalled();
    expect(result.bindingsEvaluated).toBe(0);
  });

  it('resolves interval and jitter env vars with documented defaults', async () => {
    configGet.mockReturnValue(undefined);
    const svc = await buildService();

    expect(svc.resolveIntervalMs()).toBe(300_000);
    expect(svc.resolveJitterMs()).toBe(30_000);

    configGet.mockImplementation((key: string) => {
      if (key === 'GITOPS_RECONCILIATION_INTERVAL_MS') return '1500';
      if (key === 'GITOPS_RECONCILIATION_JITTER_MS') return '200';
      return undefined;
    });
    expect(svc.resolveIntervalMs()).toBe(1500);
    expect(svc.resolveJitterMs()).toBe(200);

    configGet.mockImplementation((key: string) => {
      if (key === 'GITOPS_RECONCILIATION_INTERVAL_MS') return 'not-a-number';
      return undefined;
    });
    expect(svc.resolveIntervalMs()).toBe(300_000);
  });

  it('emitDeprecatedApplyEvent forwards payload to the event ledger', async () => {
    configGet.mockReturnValue(undefined);
    const svc = await buildService();

    await svc.emitDeprecatedApplyEvent({
      bindingId: 'binding-1',
      emittedAt: '2026-06-22T10:15:00.000Z',
      reason: 'legacy POST /gitops/reconcile',
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'gitops',
        eventName: 'gitops.reconciliation.deprecated_apply',
        outcome: 'success',
      }),
    );
  });

  it('wires resolveJitterMs() into the underlying reconciliation loop', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'GITOPS_RECONCILIATION_INTERVAL_MS') return '1000';
      if (key === 'GITOPS_RECONCILIATION_JITTER_MS') return '250';
      return undefined;
    });
    // Capture every delay passed to setTimeout so we can
    // verify the service forwards the resolved jitter to the
    // loop, which must then honor it via scheduleNext().
    const capturedDelays: number[] = [];
    const fakeTimer = { unref: () => undefined } as unknown as NodeJS.Timeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((...args: unknown[]) => {
        const delayArg = args[1];
        if (typeof delayArg === 'number') {
          capturedDelays.push(delayArg);
        }
        return fakeTimer;
      });

    try {
      const svc = await buildService();
      // Drive scheduleNext() on the wrapped loop directly to
      // avoid waiting for real timers. The service hands the
      // resolved interval/jitter to the loop via its
      // constructor params, so reaching into the loop is the
      // most direct way to assert the wiring end-to-end.
      const loop = (svc as unknown as { loop: { scheduleNext: () => void } })
        .loop;
      loop.scheduleNext();
      loop.scheduleNext();
      loop.scheduleNext();

      expect(capturedDelays.length).toBeGreaterThanOrEqual(3);
      for (const delay of capturedDelays) {
        // Envelope: [intervalMs, intervalMs + jitterMs)
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThan(1250);
      }
      const distinctDelays = new Set(capturedDelays);
      expect(distinctDelays.size).toBeGreaterThan(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
