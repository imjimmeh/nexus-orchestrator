import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { TokenCounterService } from './token-counter.service';
import { MemoryTokenBudgetResolver } from './memory-token-budget.resolver';
import { MemoryManagerService } from './memory-manager.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { MEMORY_BACKEND_TOKEN } from './memory-backend.constants';
import type { MemoryBackend, MemoryType } from './memory-backend.types';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { EmbeddingWriteEnqueueService } from './signals/embedding-write-enqueue.service';
import { MemoryContentScannerService } from './memory-content-scanner.service';

/**
 * Local structural type for memory segments returned by the mock
 * backend. The full `IMemorySegment` interface lives in
 * `packages/core` and is normally imported via the `@nexus/core` alias,
 * but the `tsc` invocation used by CI does not honour that alias, so
 * tests in this module declare the shape they exercise inline.
 */
interface FakeMemorySegment {
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  memory_type: MemoryType;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Integration test for the 200k-model end of the memory-context pipeline.
 *
 * The unit-level coverage of `MemoryTokenBudgetResolver` and
 * `TokenCounterService` already proves the math; this spec wires the
 * REAL resolver, the REAL token counter, and a REAL `MemoryManagerService`
 * through NestJS DI to assert that the slice the agent prompt renders
 * really does scale with the active model.
 *
 * The decisive bug-fix demonstration:
 *   - Under the OLD hardcoded 128k cap, ANY payload above 102.4k tokens
 *     (`128_000 * 0.8`) tripped the threshold — even on a 200k-context
 *     model that has 160k tokens of headroom.
 *   - Under the NEW model-aware resolver, the cap for a 200k model is
 *     200_000, the 60% memory slice is 120_000, and the threshold at
 *     0.8 lands at 160_000. A ~110k-token payload therefore fits
 *     comfortably on a 200k model but would have been incorrectly
 *     flagged as oversized against the old 128k cap.
 *
 * The assertions below are the acceptance criteria for milestone 5
 * ("Integration test asserting memory_context size respects the slice
 * for a 200k model").
 */

const MODEL_200K = 'claude-sonnet-200k';
const MODEL_128K = 'claude-sonnet-128k';

interface AiConfigMock {
  getModelForUseCase: Mock;
  getTokenLimit: Mock;
}

interface BackendMock {
  createMemorySegment: Mock;
  getMemorySegments: Mock;
  getMemorySegmentsByType: Mock;
  searchMemory: Mock;
  searchMemoryByType: Mock;
  updateMemorySegment: Mock;
  updateMemorySegmentWithMetadata: Mock;
  deleteMemorySegment: Mock;
}

function makeAiConfigMock(
  tokenLimits: Record<string, number>,
  modelName: string = MODEL_200K,
): AiConfigMock {
  return {
    getModelForUseCase: vi.fn().mockResolvedValue(modelName),
    getTokenLimit: vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(tokenLimits[name] ?? 0),
      ),
  };
}

function makeBackendMock(): BackendMock {
  return {
    createMemorySegment: vi.fn().mockImplementation(
      (
        entityType: string,
        entityId: string,
        content: string,
        memoryType?: MemoryType,
      ): Promise<FakeMemorySegment> =>
        Promise.resolve({
          id: `seg-${entityId}-${String(memoryType ?? 'fact')}`,
          entity_type: entityType,
          entity_id: entityId,
          content,
          memory_type: memoryType ?? 'fact',
          version: 1,
          created_at: new Date('2026-06-15T00:00:00.000Z'),
          updated_at: new Date('2026-06-15T00:00:00.000Z'),
        }),
    ),
    getMemorySegments: vi.fn().mockResolvedValue([]),
    getMemorySegmentsByType: vi.fn().mockResolvedValue([]),
    searchMemory: vi.fn().mockResolvedValue([]),
    searchMemoryByType: vi.fn().mockResolvedValue([]),
    updateMemorySegment: vi.fn().mockResolvedValue(null),
    // Mirror the strategic-intent upsert contract added in work
    // item 3fd06164 (Milestone 1): the metadata-aware update
    // method is now REQUIRED on the `MemoryBackend` interface,
    // so any latent future call from this spec must resolve
    // cleanly. The integration suite does not currently exercise
    // the upsert path, but keeping the stub symmetric with the
    // interface makes any future re-typing compile.
    updateMemorySegmentWithMetadata: vi.fn().mockResolvedValue(null),
    deleteMemorySegment: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Build a JSONL payload of ~120k tokens using the same recipe as the
 * existing `token-counter.service.spec.ts` so the token counts are
 * deterministic and reproducible.
 *
 * Each line is ~57 BPE tokens; with `repeat(70)` each entry serialises
 * to ~4_000 tokens; 30 entries then weigh in at ~120_000 tokens — the
 * 60% slice of a 200k model.
 */
function build200kSlicePayload(): Array<Record<string, string>> {
  const line = (
    'apple banana cherry dog elephant fox grape house igloo jungle ' +
    'kettle lemon mango nest orange pear queen rabbit snake tree ' +
    'umbrella violet whale xenon yellow zebra alpha beta gamma delta ' +
    'epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho ' +
    'sigma tau upsilon phi chi psi omega'
  ).repeat(70);
  return Array(30).fill({ id: '1', content: line });
}

describe('MemoryTokenBudget integration (200k model)', () => {
  let module: TestingModule;
  let resolver: MemoryTokenBudgetResolver;
  let tokenCounter: TokenCounterService;
  let memoryManager: MemoryManagerService;
  let backend: BackendMock;

  beforeEach(async () => {
    const aiConfig = makeAiConfigMock({ [MODEL_200K]: 200_000 });
    backend = makeBackendMock();

    module = await Test.createTestingModule({
      providers: [
        TokenCounterService,
        MemoryManagerService,
        {
          provide: AiConfigurationService,
          useValue: aiConfig,
        },
        {
          provide: MEMORY_BACKEND_TOKEN,
          useValue: backend,
        },
        {
          provide: MemoryTokenBudgetResolver,
          useFactory: (
            aiCfg: AiConfigurationService,
          ): MemoryTokenBudgetResolver =>
            MemoryTokenBudgetResolver.create(aiCfg),
          inject: [AiConfigurationService],
        },
        // The main branch's MemoryManagerService contract gained
        // `MemoryMetricsService` and `MetricsService` constructor
        // parameters (work item `190b3cfc` lifted the manager onto
        // the prom-client + in-memory observability stack). The
        // integration spec exercises the manager through the
        // resolver, so the metric services are stubbed here rather
        // than recreated.
        {
          provide: MemoryMetricsService,
          useValue: {
            recordBackendRead: vi.fn(),
            recordBackendWrite: vi.fn(),
            recordBackendFallback: vi.fn(),
            recordDistillationCompleted: vi.fn(),
            recordLearningPromoted: vi.fn(),
            setActiveSegments: vi.fn(),
            snapshot: vi.fn(() => ({
              backend: {
                read: {
                  total: { postgres: 0, honcho: 0 },
                  latency_ms: {},
                },
                write: {
                  total: {
                    postgres: { success: 0, failure: 0 },
                    honcho: { success: 0, failure: 0 },
                  },
                },
                active_segments: { total: { postgres: {}, honcho: {} } },
                fallback: {},
              },
              distillation: {
                completed_total: { success: 0, failure: 0 },
                last: null,
              },
              learning: { promoted_total: 0, last_promoted: null },
              generated_at: new Date().toISOString(),
            })),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            recordMemoryBackendRead: vi.fn(),
            recordMemoryBackendWrite: vi.fn(),
            setMemoryBackendActiveSegments: vi.fn(),
            recordMemoryBackendFallback: vi.fn(),
            recordDistillationCompleted: vi.fn(),
            recordLearningPromoted: vi.fn(),
          },
        },
        // Read-path reinforcement (work item 3d7fb798, milestone 3):
        // `MemoryManagerService.getMemorySegments` /
        // `searchMemory` now invoke
        // `MemorySegmentRepository.touchReinforcedAt(ids)` as a
        // fire-and-forget bump. The integration spec exercises the
        // manager through the resolver, so the repo is stubbed with
        // a no-op so the read methods do not throw on the new
        // dependency. Per-method coverage of the bump lives in
        // `memory-manager.service.spec.ts` and
        // `memory-segment.repository.spec.ts`.
        {
          provide: MemorySegmentDecayRepository,
          useValue: {
            touchReinforcedAt: vi
              .fn<(ids: string[]) => Promise<void>>()
              .mockResolvedValue(undefined),
          },
        },
        {
          provide: EmbeddingWriteEnqueueService,
          useValue: {
            enqueueOwner: vi.fn(),
          },
        },
        {
          provide: MemoryContentScannerService,
          useValue: {
            scanContent: vi.fn(),
          },
        },
      ],
    }).compile();

    resolver = module.get<MemoryTokenBudgetResolver>(MemoryTokenBudgetResolver);
    tokenCounter = module.get<TokenCounterService>(TokenCounterService);
    memoryManager = module.get<MemoryManagerService>(MemoryManagerService);
  });

  describe('resolver slice', () => {
    it('partitions a 200k context window into 60/30/10 (memory === 120_000)', async () => {
      const budget = await resolver.resolve();

      expect(budget).toEqual({
        contextWindow: 200_000,
        memory: 120_000,
        working: 60_000,
        reserved: 20_000,
        memoryPercent: 60,
        workingPercent: 30,
        reservedPercent: 10,
      });

      // Decisive assertion: the 60% memory slice is 120_000, NOT the
      // old hardcoded 128_000 cap.
      expect(budget.memory).toBe(120_000);
      expect(budget.memory).not.toBe(128_000);
      expect(budget.contextWindow).toBe(200_000);
      expect(budget.contextWindow).not.toBe(128_000);

      // The three slices must still sum to the context window so the
      // budget is internally consistent.
      expect(budget.memory + budget.working + budget.reserved).toBe(
        budget.contextWindow,
      );
    });
  });

  describe('TokenCounterService cap', () => {
    it('returns the 200k context window for a 200k model, not the 128k fallback', async () => {
      const cap = await tokenCounter.getTokenLimit(MODEL_200K);

      // The model-aware cap must be the source of truth for known
      // models; the 128k fallback must NOT be silently returned.
      expect(cap).toBe(200_000);
      expect(cap).not.toBe(128_000);
    });
  });

  describe('isOverThreshold under a 200k model', () => {
    it('does NOT trip at 80% of a 200k model for a ~120k-token payload', async () => {
      const payload = build200kSlicePayload();

      // Sanity check: the payload token count lives between the old
      // 102.4k tripwire and the new 160k tripwire.
      const tokenCount = tokenCounter.countJSONLTokens(payload, MODEL_200K);
      expect(tokenCount).toBeGreaterThan(102_400);
      expect(tokenCount).toBeLessThan(160_000);
      expect(tokenCount).toBeLessThan(120_000);

      const isOver = await tokenCounter.isOverThreshold(
        payload,
        MODEL_200K,
        0.8,
      );

      // The 200k model has 200_000 * 0.8 = 160_000 tokens of headroom
      // for memory, so a ~120k payload MUST NOT be flagged.
      expect(isOver).toBe(false);
    });

    it('WOULD have tripped the old 128k cap for the same payload (bug fix evidence)', async () => {
      const payload = build200kSlicePayload();

      // Simulate the old hardcoded behaviour: the 128k cap was used
      // for ALL models regardless of the active context window, so
      // the threshold was 128_000 * 0.8 = 102_400 tokens.
      const oldCapLimit = 128_000;
      const oldThreshold = 0.8;
      const oldTripwire = oldCapLimit * oldThreshold;

      const tokenCount = tokenCounter.countJSONLTokens(payload, MODEL_128K);
      expect(tokenCount).toBeGreaterThan(oldTripwire);

      // Re-implement the OLD code path inline (no resolver lookup)
      // to prove the payload is over the OLD threshold.
      const isOverUnderOldCap = tokenCount > oldTripwire;
      expect(isOverUnderOldCap).toBe(true);
    });

    it('does NOT trip for a small payload on either cap (control case)', async () => {
      const smallPayload = [
        { id: '1', content: 'a short memory about a small fact' },
      ];

      const newIsOver = await tokenCounter.isOverThreshold(
        smallPayload,
        MODEL_200K,
        0.8,
      );
      expect(newIsOver).toBe(false);
    });
  });

  describe('MemoryManagerService path', () => {
    it('round-trips a memory segment whose size fits the 60% slice', async () => {
      // A memory segment whose content is well under the 60% slice
      // (120_000 tokens for a 200k model) must persist + read back
      // unchanged. The old 128k cap was a TOKEN threshold, not a
      // content-size guard, so this is mainly a smoke test that the
      // DI graph wires the real MemoryManagerService through the
      // mocked backend without any 128k-leakage.
      const content = 'the user prefers dark mode and concise replies';

      const created = await memoryManager.createMemorySegment(
        'User',
        'u-200k',
        content,
        'preference',
      );

      expect(backend.createMemorySegment).toHaveBeenCalledWith(
        'User',
        'u-200k',
        content,
        'preference',
      );
      expect(created.entity_id).toBe('u-200k');
      expect(created.content).toBe(content);
      expect(created.memory_type).toBe('preference');
    });

    it('reflects the 60% slice in the resolved budget that downstream consumers read', async () => {
      // The resolver and the token counter MUST agree: a 200k model
      // gives a 120_000 memory slice, not a 128_000 hardcoded cap.
      const [budget, cap] = await Promise.all([
        resolver.resolve(),
        tokenCounter.getTokenLimit(MODEL_200K),
      ]);

      expect(budget.memory).toBe(120_000);
      expect(cap).toBe(200_000);

      // The memory slice is 60% of the cap; the cap is the context
      // window. These are the two values a consumer of
      // `memory_context` needs to size the rendered block.
      expect(budget.memory).toBe(Math.floor(0.6 * cap));
      expect(budget.memory).not.toBe(Math.floor(0.6 * 128_000));
    });
  });
});
