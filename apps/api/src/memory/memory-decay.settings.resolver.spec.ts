/**
 * Unit tests for `MemoryDecaySettingsResolver` (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 4).
 *
 * Three-branch priority chain under test:
 *   1. `MemoryRetentionPolicyRepository.getCurrent()` returns a
 *      row with a non-null `usefulness_threshold` → use it.
 *   2. Else `SystemSettingsService` key
 *      `memory_decay_usefulness_threshold` is present → use it.
 *   3. Else hardcoded `MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT`
 *      (currently `0.6`).
 *
 * Test matrix:
 *   - branch 1: repo returns `{usefulness_threshold: 0.7}` →
 *     resolver returns 0.7.
 *   - branch 2: repo returns null, settings returns `0.5` →
 *     resolver returns 0.5.
 *   - branch 2 fallback: repo returns null, settings throws →
 *     resolver returns the hardcoded default (0.6).
 *   - branch 3: repo returns null, settings returns null →
 *     resolver returns the hardcoded default (0.6).
 *   - branch 1 fallback: repo throws → falls through to branch 2
 *     (returns 0.5 from settings).
 *   - branch 1 with stringified threshold (mirrors the production
 *     `numeric` column that TypeORM returns as a string) →
 *     resolver returns the coerced number.
 *   - resolver dependency is `@Optional()` — the resolver
 *     resolves correctly with no repo bound.
 *   - the 1-second in-memory cache short-circuits a repeat
 *     resolve inside the TTL window.
 *
 * Mirrors the project's `Test.createTestingModule({ providers
 * }).compile()` pattern with hand-rolled fakes (no Testcontainers,
 * no live DB, no live BullMQ). Uses a per-test module build so
 * the in-memory cache does not leak between scenarios.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryDecaySettingsResolver } from './memory-decay.settings.resolver';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MemoryRetentionPolicyRepository } from './learning/learning-convergence/database/repositories/memory-retention-policy.repository';
import type { MemoryRetentionPolicy } from './learning/learning-convergence/database/entities/memory-retention-policy.entity';
import {
  MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
} from '../settings/memory-decay-value.settings.constants';

// ---------------------------------------------------------------------------
// Mock interfaces
// ---------------------------------------------------------------------------

interface MockSystemSettingsService {
  get: ReturnType<typeof vi.fn<[string, unknown], Promise<unknown>>>;
}

interface MockMemoryRetentionPolicyRepository {
  getCurrent: ReturnType<
    typeof vi.fn<[], Promise<MemoryRetentionPolicy | null>>
  >;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildPolicy(
  overrides: Partial<MemoryRetentionPolicy> = {},
): MemoryRetentionPolicy {
  return {
    id: 1,
    usefulness_threshold: '0.5',
    recalibrated_at: new Date('2026-07-08T12:00:00.000Z'),
    sample_size: 0,
    ...overrides,
  };
}

interface ResolverDeps {
  settings: MockSystemSettingsService;
  policyRepo?: MockMemoryRetentionPolicyRepository;
}

async function buildModule(deps: ResolverDeps): Promise<{
  moduleRef: TestingModule;
  resolver: MemoryDecaySettingsResolver;
}> {
  const providers: Provider[] = [
    MemoryDecaySettingsResolver,
    { provide: SystemSettingsService, useValue: deps.settings },
  ];
  if (deps.policyRepo) {
    providers.push({
      provide: MemoryRetentionPolicyRepository,
      useValue: deps.policyRepo,
    });
  }
  const moduleRef = await Test.createTestingModule({
    providers,
  }).compile();
  const resolver = moduleRef.get(MemoryDecaySettingsResolver);
  return { moduleRef, resolver };
}

function createDeps(): ResolverDeps {
  return {
    settings: {
      get: vi
        .fn<[string, unknown], Promise<unknown>>()
        .mockImplementation(async (_key, defaultValue) => defaultValue),
    },
    policyRepo: {
      getCurrent: vi
        .fn<[], Promise<MemoryRetentionPolicy | null>>()
        .mockResolvedValue(null),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDecaySettingsResolver', () => {
  let deps: ResolverDeps;

  beforeEach(() => {
    deps = createDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('3-branch priority chain', () => {
    it('branch 1: repo returns a row with usefulness_threshold=0.7 → resolves to 0.7', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(
        buildPolicy({ usefulness_threshold: '0.7' }),
      );
      deps.settings.get.mockResolvedValue(0.5);

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(0.7);
      expect(deps.policyRepo!.getCurrent).toHaveBeenCalledTimes(1);
      // Branch 1 hit → branch 2 (settings) was never consulted.
      expect(deps.settings.get).not.toHaveBeenCalled();

      await moduleRef.close();
    });

    it('branch 1: repo returns a row with a stringified numeric threshold (production type) → resolves to the coerced number', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(
        buildPolicy({ usefulness_threshold: '0.42' }),
      );

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(0.42);
      expect(deps.settings.get).not.toHaveBeenCalled();

      await moduleRef.close();
    });

    it('branch 2: repo returns null, settings returns 0.5 → resolves to 0.5', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(null);
      deps.settings.get.mockImplementation(async (key, defaultValue) => {
        if (key === MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING) {
          return 0.5;
        }
        return defaultValue;
      });

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(0.5);
      expect(deps.policyRepo!.getCurrent).toHaveBeenCalledTimes(1);
      expect(deps.settings.get).toHaveBeenCalledWith(
        MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
        null,
      );

      await moduleRef.close();
    });

    it('branch 2 fallback: repo returns null, settings throws → resolves to the hardcoded default', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(null);
      deps.settings.get.mockRejectedValue(new Error('settings outage'));

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT);
      expect(result).toBe(0.6);

      await moduleRef.close();
    });

    it('branch 3: repo returns null, settings returns null → resolves to the hardcoded default', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(null);
      // The `null` sentinel default in the resolver surfaces here:
      // SystemSettingsService.get(key, null) returns `null` when
      // the key is absent, and the resolver treats that as
      // "fall through to branch 3".
      deps.settings.get.mockResolvedValue(null);

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT);
      expect(result).toBe(0.6);

      await moduleRef.close();
    });

    it('branch 1 fallback: repo throws → falls through to branch 2 (settings) and returns the settings value', async () => {
      deps.policyRepo!.getCurrent.mockRejectedValue(new Error('db blip'));
      deps.settings.get.mockImplementation(async (key, defaultValue) => {
        if (key === MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING) {
          return 0.5;
        }
        return defaultValue;
      });

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(0.5);
      expect(deps.settings.get).toHaveBeenCalledWith(
        MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
        null,
      );

      await moduleRef.close();
    });

    it('branch 1 fallback chain: repo throws, settings throws → resolves to the hardcoded default', async () => {
      deps.policyRepo!.getCurrent.mockRejectedValue(new Error('db blip'));
      deps.settings.get.mockRejectedValue(new Error('settings outage'));

      const { moduleRef, resolver } = await buildModule(deps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT);

      await moduleRef.close();
    });
  });

  describe('@Optional() policyRepo dependency', () => {
    it('resolves correctly with no policyRepo bound (branch 2 → branch 3)', async () => {
      // Build a module WITHOUT a MemoryRetentionPolicyRepository
      // provider. NestJS must accept the `@Optional()` injection
      // and the resolver must skip branch 1.
      const settingsOnlyDeps: ResolverDeps = {
        settings: {
          get: vi
            .fn<[string, unknown], Promise<unknown>>()
            .mockResolvedValue(null),
        },
      };

      const { moduleRef, resolver } = await buildModule(settingsOnlyDeps);
      const result = await resolver.resolveUsefulnessThreshold();

      expect(result).toBe(MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT);
      expect(settingsOnlyDeps.settings.get).toHaveBeenCalledWith(
        MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
        null,
      );

      await moduleRef.close();
    });
  });

  describe('1-second in-memory cache', () => {
    it('short-circuits a repeat resolve inside the TTL window', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(
        buildPolicy({ usefulness_threshold: '0.7' }),
      );
      deps.settings.get.mockResolvedValue(0.5);

      const { moduleRef, resolver } = await buildModule(deps);

      const first = await resolver.resolveUsefulnessThreshold();
      const second = await resolver.resolveUsefulnessThreshold();

      expect(first).toBe(0.7);
      expect(second).toBe(0.7);
      // Branch 1 was only consulted once — the second resolve
      // hit the cache.
      expect(deps.policyRepo!.getCurrent).toHaveBeenCalledTimes(1);
      expect(deps.settings.get).not.toHaveBeenCalled();

      await moduleRef.close();
    });

    it('re-resolves after the TTL window expires', async () => {
      deps.policyRepo!.getCurrent.mockResolvedValue(
        buildPolicy({ usefulness_threshold: '0.7' }),
      );
      deps.settings.get.mockResolvedValue(0.5);

      const { moduleRef, resolver } = await buildModule(deps);

      // Pin the initial cache timestamp via the first resolve.
      const initialNow = Date.now();
      const dateNowSpy = vi
        .spyOn(Date, 'now')
        .mockReturnValueOnce(initialNow)
        .mockReturnValueOnce(initialNow + 2_000);

      const first = await resolver.resolveUsefulnessThreshold();
      const second = await resolver.resolveUsefulnessThreshold();

      expect(first).toBe(0.7);
      expect(second).toBe(0.7);
      // Cache expired after 2s — branch 1 was consulted twice.
      expect(deps.policyRepo!.getCurrent).toHaveBeenCalledTimes(2);

      dateNowSpy.mockRestore();
      await moduleRef.close();
    });
  });
});
