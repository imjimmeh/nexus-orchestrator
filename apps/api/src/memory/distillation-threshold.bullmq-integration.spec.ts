import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DistillationConsumer } from './distillation.consumer';
import { DistillationThresholdService } from './distillation-threshold.service';
import { TokenCounterService } from './token-counter.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { LLMService } from './llm.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { NoopProjectGoalOverrideAccessor } from './project-goal-override.types';
import {
  MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
  MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
} from '../settings/distillation-threshold.constants';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import { MemoryTokenBudgetResolver } from './memory-token-budget.resolver';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

/**
 * Co-located integration test for work item 3effbfa9.
 *
 * Wires a real DistillationThresholdService (backed by a fake
 * SystemSettingsService that mimics the production read semantics)
 * into the DistillationConsumer and asserts that the resolved
 * threshold flows through to the `TokenCounterService.isOverThreshold`
 * scheduling call. Mirrors the milestone 1+2 wiring in
 * `MemoryModule` so any future DI drift surfaces here.
 */
describe('DistillationConsumer × DistillationThresholdService (BullMQ integration)', () => {
  let sessionTreeRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let llmService: { summarizeNode: ReturnType<typeof vi.fn> };
  let tokenCounter: {
    countJSONLTokens: ReturnType<typeof vi.fn>;
    isOverThreshold: ReturnType<typeof vi.fn>;
  };
  let memoryMetrics: ReturnType<typeof createMemoryMetrics>;
  let promMetrics: ReturnType<typeof createPromClient>;
  let eventLedger: ReturnType<typeof createEventLedger>;
  let fakeSystemSettings: {
    get: ReturnType<typeof vi.fn>;
  };
  let consumer: DistillationConsumer;

  beforeEach(() => {
    sessionTreeRepo = {
      findById: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };
    llmService = {
      summarizeNode: vi.fn(async (content: string) => content),
    };
    tokenCounter = {
      countJSONLTokens: vi.fn(),
      isOverThreshold: vi.fn(() => false),
    };
    memoryMetrics = createMemoryMetrics();
    promMetrics = createPromClient();
    eventLedger = createEventLedger();
    fakeSystemSettings = {
      get: vi.fn<(key: string, defaultValue: unknown) => Promise<unknown>>(),
    };

    // Wire the real DistillationThresholdService backed by a fake
    // SystemSettingsService. The fake mimics the production
    // `get<T>(key, defaultValue)` contract so the resolver walks the
    // real precedence chain. The ProjectGoal accessor is the noop
    // default; in production the followup bridge work item will
    // rebind the token to a real accessor.
    const thresholdService = new DistillationThresholdService(
      fakeSystemSettings as unknown as SystemSettingsService,
      new NoopProjectGoalOverrideAccessor(),
    );

    consumer = new DistillationConsumer(
      sessionTreeRepo as unknown as PiSessionTreeRepository,
      llmService as unknown as LLMService,
      tokenCounter as unknown as TokenCounterService,
      // The merged consumer also depends on the model-aware budget
      // resolver (work item ddfdcead); provide a noop stub that
      // returns the documented 128k default so the threshold-driven
      // scheduling test path is unaffected.
      {
        resolve: vi.fn().mockResolvedValue({
          contextWindow: 128_000,
          memory: 76_800,
          working: 38_400,
          reserved: 12_800,
          memoryPercent: 60,
          workingPercent: 30,
          reservedPercent: 10,
        }),
      } as unknown as MemoryTokenBudgetResolver,
      memoryMetrics,
      promMetrics,
      eventLedger,
      thresholdService,
    );
  });

  async function buildJsonlPayload(): Promise<string> {
    const jsonl = [
      JSON.stringify({ type: 'user', content: 'hello' }),
      JSON.stringify({ type: 'assistant', content: 'world' }),
    ].join('\n');
    const compressed = await gzip(Buffer.from(jsonl, 'utf-8'));
    return compressed.toString('base64');
  }

  it('drives the consumer with a SystemSetting-configured threshold and forwards it to the scheduling check', async () => {
    fakeSystemSettings.get.mockImplementation(((
      key: string,
      defaultValue: unknown,
    ) =>
      Promise.resolve(
        key === MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY ? 0.35 : defaultValue,
      )) as never);
    const base64 = await buildJsonlPayload();
    sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
    tokenCounter.isOverThreshold.mockReturnValue(true);
    tokenCounter.countJSONLTokens.mockReturnValue(0);

    const fakeJob = {
      data: { sessionTreeId: 'tree-int-1', model: 'claude-3-5-sonnet' },
    } as never;

    await consumer.process(fakeJob);

    expect(fakeSystemSettings.get).toHaveBeenCalledWith(
      MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
      undefined,
    );
    expect(tokenCounter.isOverThreshold).toHaveBeenCalledWith(
      expect.any(Array),
      'claude-3-5-sonnet',
      0.35,
    );
  });

  it('falls back to the hardcoded default when the SystemSetting is absent', async () => {
    fakeSystemSettings.get.mockImplementation(((
      _key: string,
      defaultValue: unknown,
    ) => Promise.resolve(defaultValue)) as never);
    const base64 = await buildJsonlPayload();
    sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
    tokenCounter.isOverThreshold.mockReturnValue(false);
    tokenCounter.countJSONLTokens.mockReturnValue(0);

    const fakeJob = {
      data: { sessionTreeId: 'tree-int-2', model: 'claude-3-5-sonnet' },
    } as never;

    const result = await consumer.process(fakeJob);

    expect(result).toMatchObject({
      skipped: true,
      threshold: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    });
    expect(tokenCounter.isOverThreshold).toHaveBeenCalledWith(
      expect.any(Array),
      'claude-3-5-sonnet',
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
  });

  it('uses the new SystemSetting value on subsequent consumer ticks', async () => {
    fakeSystemSettings.get.mockImplementationOnce(((
      key: string,
      defaultValue: unknown,
    ) =>
      Promise.resolve(
        key === MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY ? 0.7 : defaultValue,
      )) as never);
    const base64 = await buildJsonlPayload();
    sessionTreeRepo.findById.mockResolvedValue({ jsonl_data: [base64] });
    tokenCounter.isOverThreshold.mockReturnValue(true);
    tokenCounter.countJSONLTokens.mockReturnValue(0);

    const firstJob = {
      data: { sessionTreeId: 'tree-int-3', model: 'claude-3-5-sonnet' },
    } as never;
    await consumer.process(firstJob);

    fakeSystemSettings.get.mockImplementation(((
      key: string,
      defaultValue: unknown,
    ) =>
      Promise.resolve(
        key === MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY ? 0.5 : defaultValue,
      )) as never);
    const secondJob = {
      data: { sessionTreeId: 'tree-int-3', model: 'claude-3-5-sonnet' },
    } as never;
    await consumer.process(secondJob);

    expect(tokenCounter.isOverThreshold).toHaveBeenLastCalledWith(
      expect.any(Array),
      'claude-3-5-sonnet',
      0.5,
    );
  });
});

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
