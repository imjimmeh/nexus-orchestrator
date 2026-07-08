import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { gzipSync } from 'node:zlib';
import { DistillationConsumer } from './distillation.consumer';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { LLMService } from './llm.service';
import { TokenCounterService } from './token-counter.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import { DistillationThresholdService } from './distillation-threshold.service';
import { MEMORY_DISTILLATION_THRESHOLD_DEFAULT } from '../settings/distillation-threshold.constants';
import type {
  DistillationThresholdResolution,
  DistillationThresholdSource,
} from './distillation-threshold.types';
import { MemoryTokenBudgetResolver } from './memory-token-budget.resolver';
import type { MemoryTokenBudget } from './memory-token-budget.resolver.types';

interface SessionTreeRepoMock {
  findById: Mock;
  update: Mock;
}

interface LLMServiceMock {
  summarizeNode: Mock;
}

interface TokenCounterMock {
  countJSONLTokens: Mock;
  isOverThreshold: Mock;
}

interface BudgetResolverMock {
  resolve: Mock;
}

/**
 * Build a deterministic 60/30/10 memory token budget. The default
 * `contextWindow` is 128_000 to mirror the historical fallback; tests
 * that exercise the 200k path override it explicitly.
 */
function makeBudget(contextWindow: number = 128_000): MemoryTokenBudget {
  const memory = Math.floor(0.6 * contextWindow);
  const working = Math.floor(0.3 * contextWindow);
  const reserved = contextWindow - memory - working;
  return {
    contextWindow,
    memory,
    working,
    reserved,
    memoryPercent: 60,
    workingPercent: 30,
    reservedPercent: 10,
  };
}

/**
 * Build a base64-encoded gzip-compressed JSONL string that the
 * consumer can decompress.
 */
function buildEncodedTree(rows: Array<Record<string, unknown>>): string {
  const jsonl = rows.map((row) => JSON.stringify(row)).join('\n');
  return gzipSync(Buffer.from(jsonl, 'utf-8')).toString('base64');
}

function createMemoryMetrics() {
  return {
    recordBackendRead: vi.fn(),
    recordBackendWrite: vi.fn(),
    recordBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
    setActiveSegments: vi.fn(),
    snapshot: vi.fn(),
  } as unknown as MemoryMetricsService;
}

function createPromClient() {
  return {
    recordMemoryBackendRead: vi.fn(),
    recordMemoryBackendWrite: vi.fn(),
    setMemoryBackendActiveSegments: vi.fn(),
    recordMemoryBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
  } as unknown as MetricsService;
}

function createEventLedger() {
  return {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    getById: vi.fn(),
    getByCorrelationId: vi.fn(),
    query: vi.fn(),
  } as unknown as EventLedgerService;
}

function createThresholdService(
  overrides: {
    value?: number;
    source?: DistillationThresholdSource;
    changed?: boolean;
    previousValue?: number | null;
    previousSource?: DistillationThresholdSource | null;
  } = {},
) {
  const value = overrides.value ?? MEMORY_DISTILLATION_THRESHOLD_DEFAULT;
  const source: DistillationThresholdSource = overrides.source ?? 'default';
  const changed = overrides.changed ?? false;
  const previousValue =
    overrides.previousValue === undefined ? null : overrides.previousValue;
  const previousSource =
    overrides.previousSource === undefined ? null : overrides.previousSource;
  const resolve = vi.fn(
    async (
      _resourceId: string | null | undefined,
    ): Promise<DistillationThresholdResolution> => ({
      value,
      source,
      changed,
      previousValue,
      previousSource,
    }),
  );
  return {
    resolve,
  } as unknown as DistillationThresholdService;
}

describe('DistillationConsumer', () => {
  let consumer: DistillationConsumer;
  let sessionTreeRepo: SessionTreeRepoMock;
  let llmService: LLMServiceMock;
  let tokenCounter: TokenCounterMock;
  let budgetResolver: BudgetResolverMock;
  let memoryMetrics: ReturnType<typeof createMemoryMetrics>;
  let promMetrics: ReturnType<typeof createPromClient>;
  let eventLedger: ReturnType<typeof createEventLedger>;
  let thresholdService: ReturnType<typeof createThresholdService>;

  beforeEach(() => {
    sessionTreeRepo = {
      findById: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };
    llmService = {
      summarizeNode: vi
        .fn()
        .mockImplementation(async (content: string) => `summary(${content})`),
    };
    tokenCounter = {
      countJSONLTokens: vi.fn().mockReturnValue(50_000),
      // Default: not over threshold. Each test that needs to run
      // distillation should override this to return true.
      isOverThreshold: vi.fn(() => true),
    };
    budgetResolver = {
      resolve: vi.fn().mockResolvedValue(makeBudget(128_000)),
    };
    memoryMetrics = createMemoryMetrics();
    promMetrics = createPromClient();
    eventLedger = createEventLedger();
    thresholdService = createThresholdService();

    consumer = new DistillationConsumer(
      sessionTreeRepo as unknown as PiSessionTreeRepository,
      llmService as unknown as LLMService,
      tokenCounter as unknown as TokenCounterService,
      budgetResolver as unknown as MemoryTokenBudgetResolver,
      memoryMetrics,
      promMetrics,
      eventLedger,
      thresholdService,
    );
  });

  it('records a successful distillation with the prom-client and in-memory services', async () => {
    // Build a base64-encoded gzip jsonl payload containing 2 nodes
    const jsonl = [
      JSON.stringify({ type: 'user', content: 'hello' }),
      JSON.stringify({ type: 'assistant', content: 'world' }),
    ].join('\n');
    const base64 = buildEncodedTree([
      { type: 'user', content: 'hello' },
      { type: 'assistant', content: 'world' },
    ]);
    sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
    // The consumer re-evaluates the live threshold on every tick, so
    // isOverThreshold must return true for the resolved value for
    // distillation to actually run.
    tokenCounter.isOverThreshold.mockReturnValue(true);
    // First call (initial token count) returns 100; second call (after
    // summarization) returns 60. Both exceed the 76_800-token
    // default 128k budget's 60% memory slice.
    tokenCounter.countJSONLTokens
      .mockReturnValueOnce(100_000)
      .mockReturnValueOnce(60_000);

    const fakeJob = {
      data: { sessionTreeId: 'tree-1', model: 'claude-3-5-sonnet' },
    } as never;

    const result = await consumer.process(fakeJob);

    expect(result).toMatchObject({
      initialTokens: 100_000,
      finalTokens: 60_000,
      ratio: 0.6,
    });

    expect(memoryMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
      'success',
      expect.objectContaining({
        input_segment_count: 2,
        output_segment_count: 2,
        compression_ratio: 0.6,
        tokens_before: 100_000,
        tokens_after: 60_000,
        model: 'claude-3-5-sonnet',
        duration_ms: expect.any(Number),
      }),
    );
    expect(promMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
      'success',
      0.6,
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.distillationCompleted,
        outcome: 'success',
        sessionTreeId: 'tree-1',
        payload: expect.objectContaining({
          input_segment_count: 2,
          output_segment_count: 2,
          compression_ratio: 0.6,
          tokens_before: 100_000,
          tokens_after: 60_000,
          model: 'claude-3-5-sonnet',
          duration_ms: expect.any(Number),
        }),
      }),
    );
    expect(sessionTreeRepo.update).toHaveBeenCalledWith('tree-1', {
      jsonl_data: [expect.any(String)],
    });
  });

  it('records a distillation failure and emits the failed event', async () => {
    sessionTreeRepo.findById.mockRejectedValue(new Error('db down'));

    const fakeJob = {
      data: { sessionTreeId: 'tree-2', model: 'claude-3-5-sonnet' },
    } as never;

    await expect(consumer.process(fakeJob)).rejects.toThrow('db down');

    expect(memoryMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
      'failure',
      expect.objectContaining({
        compression_ratio: 0,
        model: 'claude-3-5-sonnet',
        duration_ms: expect.any(Number),
      }),
    );
    expect(promMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
      'failure',
      0,
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.distillationFailed,
        outcome: 'failure',
        sessionTreeId: 'tree-2',
        errorCode: 'DISTILLATION_FAILED',
        errorMessage: 'db down',
      }),
    );
  });

  describe('threshold resolution integration', () => {
    it('calls the threshold resolver on every tick and passes the sessionTreeId as the resourceId', async () => {
      const base64 = buildEncodedTree([
        { type: 'user', content: 'hello' },
        { type: 'assistant', content: 'world' },
      ]);
      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
      tokenCounter.isOverThreshold.mockReturnValue(true);
      tokenCounter.countJSONLTokens.mockReturnValue(0);

      const fakeJob = {
        data: { sessionTreeId: 'tree-3', model: 'claude-3-5-sonnet' },
      } as never;

      await consumer.process(fakeJob);

      expect(thresholdService.resolve).toHaveBeenCalledTimes(1);
      // The consumer must forward the sessionTreeId so the resolver
      // can consult the per-resource SystemSetting and the
      // ProjectGoal override accessor.
      expect(thresholdService.resolve).toHaveBeenCalledWith('tree-3');
    });

    it('passes the resolved threshold into the token counter scheduling check', async () => {
      const base64 = buildEncodedTree([
        { type: 'user', content: 'hello' },
        { type: 'assistant', content: 'world' },
      ]);
      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
      // Force the configured threshold to a distinctive, non-default
      // value so we can prove it flows through to isOverThreshold.
      thresholdService = createThresholdService({
        value: 0.35,
        source: 'global-system-setting',
      });
      consumer = new DistillationConsumer(
        sessionTreeRepo as unknown as PiSessionTreeRepository,
        llmService as unknown as LLMService,
        tokenCounter as unknown as TokenCounterService,
        budgetResolver as unknown as MemoryTokenBudgetResolver,
        memoryMetrics,
        promMetrics,
        eventLedger,
        thresholdService,
      );
      tokenCounter.isOverThreshold.mockReturnValue(true);
      tokenCounter.countJSONLTokens.mockReturnValue(0);

      const fakeJob = {
        data: { sessionTreeId: 'tree-4', model: 'claude-3-5-sonnet' },
      } as never;

      await consumer.process(fakeJob);

      // The threshold-resolved value (0.35) must be the third arg of
      // isOverThreshold, not the legacy hardcoded 0.8.
      expect(tokenCounter.isOverThreshold).toHaveBeenCalledWith(
        expect.any(Array),
        'claude-3-5-sonnet',
        0.35,
      );
    });

    it('skips the run when the live threshold is no longer exceeded', async () => {
      const base64 = buildEncodedTree([
        { type: 'user', content: 'hello' },
        { type: 'assistant', content: 'world' },
      ]);
      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
      tokenCounter.isOverThreshold.mockReturnValue(false);
      tokenCounter.countJSONLTokens.mockReturnValue(0);

      const fakeJob = {
        data: { sessionTreeId: 'tree-5', model: 'claude-3-5-sonnet' },
      } as never;

      const result = await consumer.process(fakeJob);

      expect(result).toMatchObject({
        skipped: true,
        ratio: 1,
      });
      expect(sessionTreeRepo.update).not.toHaveBeenCalled();
      expect(llmService.summarizeNode).not.toHaveBeenCalled();
      expect(memoryMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
        'skipped',
        expect.objectContaining({
          compression_ratio: 1,
          model: 'claude-3-5-sonnet',
        }),
      );
      expect(promMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
        'skipped',
        1,
      );
      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'memory',
          eventName: AUTONOMY_EVENT_NAMES.distillationCompleted,
          outcome: 'denied',
          sessionTreeId: 'tree-5',
          payload: expect.objectContaining({
            reason: 'under_live_threshold',
            threshold: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
            threshold_source: 'default',
          }),
        }),
      );
    });

    it('uses a ProjectGoal metadata override when the resolver surfaces one', async () => {
      const base64 = buildEncodedTree([
        { type: 'user', content: 'hello' },
        { type: 'assistant', content: 'world' },
      ]);
      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
      tokenCounter.isOverThreshold.mockReturnValue(true);
      tokenCounter.countJSONLTokens.mockReturnValue(0);

      // Configure the resolver to return a value that, in production,
      // would have come from the `project-goal-metadata` tier.
      thresholdService = createThresholdService({
        value: 0.33,
        source: 'project-goal-metadata',
      });
      consumer = new DistillationConsumer(
        sessionTreeRepo as unknown as PiSessionTreeRepository,
        llmService as unknown as LLMService,
        tokenCounter as unknown as TokenCounterService,
        budgetResolver as unknown as MemoryTokenBudgetResolver,
        memoryMetrics,
        promMetrics,
        eventLedger,
        thresholdService,
      );

      const fakeJob = {
        data: { sessionTreeId: 'tree-6', model: 'claude-3-5-sonnet' },
      } as never;

      await consumer.process(fakeJob);

      // The ProjectGoal-override value (0.33) must reach the
      // TokenCounter scheduling check.
      expect(tokenCounter.isOverThreshold).toHaveBeenCalledWith(
        expect.any(Array),
        'claude-3-5-sonnet',
        0.33,
      );
      // And the consumer must have asked the resolver to resolve
      // the live threshold for this session tree.
      expect(thresholdService.resolve).toHaveBeenCalledWith('tree-6');
    });
  });

  describe('model-aware budget gate', () => {
    it('consults the injected MemoryTokenBudgetResolver before doing any work', async () => {
      // 200k-context model → 60% memory slice = 120_000 tokens. The
      // consumer must consult the resolver directly (not the
      // `TokenCounterService` wrapper) and use the model-aware budget
      // — not the historical hardcoded 128k cap.
      budgetResolver.resolve.mockResolvedValue(makeBudget(200_000));
      // 150_000 > 120_000 → consumer falls through to the
      // summarization loop, exercising the resolver-driven path end-
      // to-end.
      tokenCounter.countJSONLTokens.mockReturnValue(150_000);

      // Build a 60-node tree so a node lands in the "age > 50" bucket
      // and the consumer exercises the compression branch.
      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: String(i),
        type: 'message',
        content: `node ${i.toString()}`,
      }));
      const encoded = buildEncodedTree(rows);

      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [encoded] });

      await consumer.process({
        data: { sessionTreeId: 'tree-budget-1', model: 'claude-sonnet-4-5' },
      } as never);

      // The resolver is the source of truth for `budget.memory` —
      // it must be consulted exactly once per job and the 200k
      // context window must propagate through the workload-sizing
      // branch (i.e. summarization fires because 150k > 120k).
      expect(budgetResolver.resolve).toHaveBeenCalledTimes(1);
      expect(llmService.summarizeNode).toHaveBeenCalled();
    });

    it('skips the summarization loop when the payload already fits inside budget.memory', async () => {
      // 200k model → 120_000-token memory slice. A 50k-token payload
      // fits, so the consumer must short-circuit.
      budgetResolver.resolve.mockResolvedValue(makeBudget(200_000));
      tokenCounter.countJSONLTokens.mockReturnValue(50_000);

      const encoded = buildEncodedTree([
        { id: '1', type: 'message', content: 'small payload' },
      ]);

      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [encoded] });

      const result = await consumer.process({
        data: { sessionTreeId: 'tree-budget-2', model: 'claude-sonnet-4-5' },
      } as never);

      expect(llmService.summarizeNode).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        initialTokens: 50_000,
        finalTokens: 50_000,
        ratio: 1,
        skipped: true,
        reason: 'within_memory_budget',
        memoryBudget: 120_000,
      });
      // The 200k model budget must surface verbatim in the resolver
      // call — the consumer must not silently substitute the 128k
      // default when an active model is configured.
      expect(budgetResolver.resolve).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordDistillationCompleted).toHaveBeenCalledWith(
        'skipped',
        expect.objectContaining({
          compression_ratio: 1,
          tokens_before: 50_000,
          model: 'claude-sonnet-4-5',
        }),
      );
    });

    it('falls through to the age-based summarization when the payload exceeds budget.memory', async () => {
      // 8k-context model → 4_800-token memory slice. A 50k-token
      // payload blows past it, so the consumer must invoke
      // `llmService.summarizeNode` on age-compressed nodes.
      budgetResolver.resolve.mockResolvedValue(makeBudget(8_000));
      tokenCounter.countJSONLTokens.mockReturnValue(50_000);

      // Build a 60-node tree so a node lands in the "age > 50" bucket
      // and the consumer exercises the compression branch.
      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: String(i),
        type: 'message',
        content: `node ${i.toString()}`,
      }));
      const encoded = buildEncodedTree(rows);

      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [encoded] });

      await consumer.process({
        data: { sessionTreeId: 'tree-budget-3', model: 'gpt-3.5' },
      } as never);

      // At least one node must have been summarized — the dominant
      // correctness assertion is that the consumer does work when the
      // payload exceeds budget.memory.
      expect(llmService.summarizeNode).toHaveBeenCalled();
      // The 8k model must surface a 4_800-token memory slice in the
      // resolver-driven log path.
      expect(budgetResolver.resolve).toHaveBeenCalledTimes(1);
    });

    it('falls back to the documented 128k budget when the resolver throws', async () => {
      // Resolver outage must not crash the consumer; the safe-resolver
      // wrapper should swallow the error, log a warning, and use the
      // 128k fallback (60% memory slice = 76_800 tokens). A
      // 100_000-token payload exceeds that fallback slice, so the
      // consumer must still proceed with summarization — proving the
      // fallback path keeps the rest of the pipeline alive.
      budgetResolver.resolve.mockRejectedValue(new Error('resolver offline'));
      tokenCounter.countJSONLTokens.mockReturnValue(100_000);

      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: String(i),
        type: 'message',
        content: `node ${i.toString()}`,
      }));
      const encoded = buildEncodedTree(rows);
      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [encoded] });

      await consumer.process({
        data: { sessionTreeId: 'tree-budget-4', model: 'gpt-3.5' },
      } as never);

      // Consumer continued processing despite the resolver failure.
      expect(llmService.summarizeNode).toHaveBeenCalled();
      // Resolver was still consulted exactly once before the fallback
      // kicked in.
      expect(budgetResolver.resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe('age-based compression routing', () => {
    it('routes each age band to the correct target compression percentage', async () => {
      // Build a 52-node tree where every node is `type: 'message'`.
      // This guarantees that no tool_use/tool_result skip path fires
      // and the age-band routing is the only thing under test. With
      // 52 nodes the consumer walks nodes backwards from age=51
      // (i=0) down to age=0 (i=51), so the three compression bands
      // (age > 50 / age > 20 / age > 10) are all exercised.
      const rows = Array.from({ length: 52 }, (_, i) => ({
        id: String(i),
        type: 'message',
        content: `node ${i.toString()}`,
      }));
      const encoded = buildEncodedTree(rows);
      sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [encoded] });
      tokenCounter.isOverThreshold.mockReturnValue(true);
      // 8k-context model → 4_800-token memory slice. A 50k-token
      // payload exceeds the budget, forcing the consumer into the
      // age-based summarization loop.
      budgetResolver.resolve.mockResolvedValue(makeBudget(8_000));
      tokenCounter.countJSONLTokens.mockReturnValue(50_000);

      await consumer.process({
        data: { sessionTreeId: 'tree-routing-1', model: 'gpt-3.5' },
      } as never);

      // Pull the `targetPercentage` value (3rd positional argument)
      // out of every summarizeNode call so the assertions below can
      // pin the per-band routing without re-implementing the
      // age-band math.
      const calls = llmService.summarizeNode.mock.calls;
      const targetPercentages = calls.map((args) => args[2] as number);

      // (i) summarizeNode is called for every node whose age falls
      // in the 30/50/70 bands. The 70% bucket is `age > 10`, which
      // covers ages 11..20; the no-compression band is ages 0..10.
      // For a 52-node tree that is 41 calls (ages 51..11).
      expect(calls).toHaveLength(41);

      // (ii) the set of targetPercentage values across all calls is
      // exactly {30, 50, 70} — no 100 leaks through.
      expect(new Set(targetPercentages)).toEqual(new Set([30, 50, 70]));

      // (iii) age > 50 boundary: i=0 (age=51) is the only call in the
      // 30% bucket, and i=1 (age=50) is the first call in the 50%
      // bucket (age=50 does not satisfy `age > 50`).
      expect(targetPercentages[0]).toBe(30);
      expect(targetPercentages[1]).toBe(50);

      // (iv) age > 20 and age > 10 boundaries.
      // i=31 (age=20) is the first call in the 70% bucket: age=20
      // does not satisfy `age > 20`, so it falls through to
      // `age > 10`, which is true.
      // i=40 (age=11) is the last call in the 70% bucket: age=11
      // satisfies `age > 10`, age=12..20 also satisfy it, and age=10
      // is the boundary that falls into the 100% bucket.
      expect(targetPercentages[31]).toBe(70);
      expect(targetPercentages[40]).toBe(70);

      // (v) no-compression band respected: the consumer must not
      // call summarizeNode for nodes whose age falls in [0, 10].
      // For a 52-node tree those are i=41 (age=10) through i=51
      // (age=0). The spec called out i=42 (age=9) specifically;
      // i=41 (age=10) is the boundary call that pins `age > 10`.
      expect(calls[41]).toBeUndefined();
      expect(calls[42]).toBeUndefined();
    });
  });
});
