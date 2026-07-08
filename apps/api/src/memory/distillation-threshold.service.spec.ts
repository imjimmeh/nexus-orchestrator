import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DistillationThresholdService } from './distillation-threshold.service';
import {
  IProjectGoalOverrideAccessor,
  NoopProjectGoalOverrideAccessor,
  PROJECT_GOAL_OVERRIDE_METADATA_KEY,
  ProjectGoalOverrideRecord,
} from './project-goal-override.types';
import { EventLedgerService } from '../observability/event-ledger.service';
import type {
  MemorySettingChangedLedgerEntry,
  MemorySettingChangedPayload,
} from '../observability/event-ledger.service.types';
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';
import type { SystemSettingsService } from '../settings/system-settings.service';
import {
  MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
  MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
  coerceMemoryDistillationThreshold,
  memoryDistillationThresholdKey,
} from '../settings/distillation-threshold.constants';

interface FakeSettingsEntry {
  value: unknown;
}

function createFakeSystemSettings(
  entries: Record<string, FakeSettingsEntry | undefined> = {},
): {
  service: SystemSettingsService;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn((key: string, _defaultValue: unknown) =>
    Promise.resolve(entries[key]?.value),
  );
  return {
    service: { get } as unknown as SystemSettingsService,
    get,
  };
}

function createFakeProjectGoalAccessor(
  records: Record<string, ProjectGoalOverrideRecord | null> = {},
): {
  accessor: IProjectGoalOverrideAccessor;
  getOverrideByResourceId: ReturnType<typeof vi.fn>;
} {
  const getOverrideByResourceId = vi.fn((resourceId: string) =>
    Promise.resolve(
      Object.hasOwn(records, resourceId) ? (records[resourceId] ?? null) : null,
    ),
  );
  return {
    accessor: { getOverrideByResourceId },
    getOverrideByResourceId,
  };
}

function createFakeEventLedger(): {
  ledger: EventLedgerService;
  emitBestEffort: ReturnType<typeof vi.fn>;
  findLatestMemorySettingChangedByPayloadSource: ReturnType<
    typeof vi.fn<
      (params: {
        source: string;
      }) => Promise<MemorySettingChangedLedgerEntry | null>
    >
  >;
} {
  const emitBestEffort = vi.fn(() => Promise.resolve(undefined));
  // Default to "no rows in ledger" so existing tests that never invoke
  // `primeBaselineFromLedger()` continue to observe the legacy
  // first-call-as-baseline behaviour. Individual tests can override
  // the resolved value via `mockResolvedValueOnce` /
  // `mockResolvedValue` / `mockImplementationOnce`.
  const findLatestMemorySettingChangedByPayloadSource = vi.fn<
    (params: {
      source: string;
    }) => Promise<MemorySettingChangedLedgerEntry | null>
  >(() => Promise.resolve(null));
  return {
    ledger: {
      emitBestEffort,
      findLatestMemorySettingChangedByPayloadSource,
    } as unknown as EventLedgerService,
    emitBestEffort,
    findLatestMemorySettingChangedByPayloadSource,
  };
}

/**
 * Build a fully-typed `MemorySettingChangedLedgerEntry` fixture for
 * the priming tests. Defaults to a row that
 * `DistillationThresholdService` itself would have emitted — the
 * `payload.source` filter on the ledger lookup is
 * `DISTILLATION_THRESHOLD_EVENT_SOURCE`, so any row with a different
 * `source` will not be returned by the real repository. Tests that
 * want to exercise the SystemSettingsService producer shape must
 * explicitly override `payload.source` so the filter distinction is
 * visible to the reader.
 */
function createMemorySettingChangedEntry(
  overrides: Partial<MemorySettingChangedLedgerEntry> & {
    payloadOverrides?: Partial<MemorySettingChangedPayload>;
  } = {},
): MemorySettingChangedLedgerEntry {
  const { payloadOverrides, ...entryOverrides } = overrides;
  return {
    id: 'entry-1',
    occurredAt: new Date('2026-04-30T00:05:00.000Z'),
    payload: {
      key: 'memoryDistillationThreshold',
      previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
      previousSource: 'default',
      newValue: 0.5,
      newSource: 'global-system-setting',
      source: 'distillation-threshold.service.resolve',
      ...payloadOverrides,
    },
    ...entryOverrides,
  };
}

function configureSettings(
  settings: { get: ReturnType<typeof vi.fn> },
  values: Record<string, unknown>,
): void {
  settings.get.mockImplementation(((key: string) =>
    Promise.resolve(values[key])) as never);
}

describe('DistillationThresholdService', () => {
  describe('precedence chain', () => {
    it('honours the per-resource SystemSetting as the highest-priority tier', async () => {
      const settings = createFakeSystemSettings({
        [memoryDistillationThresholdKey('resource-A')]: { value: 0.42 },
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { [PROJECT_GOAL_OVERRIDE_METADATA_KEY]: 0.7 },
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.42,
        source: 'project-system-setting',
      });
    });

    it('falls through to the global SystemSetting when the per-resource key is missing', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.55 },
      });
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { [PROJECT_GOAL_OVERRIDE_METADATA_KEY]: 0.7 },
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.55,
        source: 'global-system-setting',
      });
    });

    it('falls through to the global SystemSetting when the per-resource key is set to undefined', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
      });
    });

    it('uses the ProjectGoal override metadata when no SystemSetting is configured', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { [PROJECT_GOAL_OVERRIDE_METADATA_KEY]: 0.65 },
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.65,
        source: 'project-goal-metadata',
      });
    });

    it('falls through to the hardcoded default when no override is configured anywhere', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        source: 'default',
      });
    });

    it('skips the per-resource + ProjectGoal tiers when resourceId is null', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.6 },
      });
      const { accessor, getOverrideByResourceId } =
        createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve(null);

      expect(result).toMatchObject({
        value: 0.6,
        source: 'global-system-setting',
      });
      expect(getOverrideByResourceId).not.toHaveBeenCalled();
    });

    it('skips the per-resource + ProjectGoal tiers when resourceId is the empty string', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.6 },
      });
      const { accessor, getOverrideByResourceId } =
        createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('');

      expect(result).toMatchObject({
        value: 0.6,
        source: 'global-system-setting',
      });
      expect(getOverrideByResourceId).not.toHaveBeenCalled();
    });
  });

  describe('per-tick change detection', () => {
    it('reports changed=false on the very first call (baseline)', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const first = await service.resolve('resource-A');

      expect(first).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: null,
        previousSource: null,
      });
    });

    it('reports changed=false when the resolution is identical to the previous call', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      await service.resolve('resource-A');
      const second = await service.resolve('resource-A');

      expect(second).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: 0.5,
        previousSource: 'global-system-setting',
      });
    });

    it('reports changed=true and emits a MemorySettingChanged event when the value drifts', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, emitBestEffort } = createFakeEventLedger();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      const first = await service.resolve('resource-A');
      configureSettings(settings, {
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: 0.45,
      });
      const second = await service.resolve('resource-A');

      expect(first).toMatchObject({
        source: 'default',
        changed: false,
      });
      expect(second).toMatchObject({
        value: 0.45,
        source: 'global-system-setting',
        changed: true,
        previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        previousSource: 'default',
      });
      expect(emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'memory',
          eventName: AUTONOMY_EVENT_NAMES.memorySettingChanged,
          outcome: 'success',
          payload: expect.objectContaining({
            key: 'memoryDistillationThreshold',
            previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
            previousSource: 'default',
            newValue: 0.45,
            newSource: 'global-system-setting',
            source: 'distillation-threshold.service.resolve',
          }),
        }),
      );
    });

    it('reports changed=true when only the source tier changes (same value)', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { [PROJECT_GOAL_OVERRIDE_METADATA_KEY]: 0.7 },
        },
      });
      const { ledger, emitBestEffort } = createFakeEventLedger();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      const first = await service.resolve('resource-A');
      configureSettings(settings, {
        [memoryDistillationThresholdKey('resource-A')]: 0.7,
      });
      const second = await service.resolve('resource-A');

      expect(first).toMatchObject({
        value: 0.7,
        source: 'project-goal-metadata',
        changed: false,
      });
      expect(second).toMatchObject({
        value: 0.7,
        source: 'project-system-setting',
        changed: true,
        previousValue: 0.7,
        previousSource: 'project-goal-metadata',
      });
      expect(emitBestEffort).toHaveBeenCalledTimes(1);
      expect(emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            previousValue: 0.7,
            previousSource: 'project-goal-metadata',
            newValue: 0.7,
            newSource: 'project-system-setting',
          }),
        }),
      );
    });

    it('does not emit when the EventLedger is not wired (back-compat)', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      await service.resolve('resource-A');
      configureSettings(settings, {
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: 0.5,
      });
      const result = await service.resolve('resource-A');

      expect(result.changed).toBe(true);
    });

    it('does not throw when the EventLedger emit fails', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor();
      const emitBestEffort = vi.fn(() =>
        Promise.reject(new Error('ledger down')),
      );
      const ledger = { emitBestEffort } as unknown as EventLedgerService;
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.resolve('resource-A');
      configureSettings(settings, {
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: 0.5,
      });
      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: true,
      });
      expect(emitBestEffort).toHaveBeenCalledTimes(1);
    });
  });

  describe('ProjectGoal override accessor', () => {
    it('queries the accessor with the resourceId from the resolve call', async () => {
      const settings = createFakeSystemSettings();
      const { accessor, getOverrideByResourceId } =
        createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      await service.resolve('resource-A');
      await service.resolve('resource-B');

      expect(getOverrideByResourceId).toHaveBeenCalledTimes(2);
      expect(getOverrideByResourceId).toHaveBeenNthCalledWith(1, 'resource-A');
      expect(getOverrideByResourceId).toHaveBeenNthCalledWith(2, 'resource-B');
    });

    it('treats a null accessor result as "no override" and falls through', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': null,
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        source: 'default',
      });
    });

    it('treats a missing metadata field as "no override" and falls through', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { otherKey: 'irrelevant' },
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        source: 'default',
      });
    });

    it('treats a null metadata field as "no override" and falls through', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: null,
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        source: 'default',
      });
    });

    it('coerces an out-of-range ProjectGoal override via the same helper as SystemSettings', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { [PROJECT_GOAL_OVERRIDE_METADATA_KEY]: 1.5 },
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        source: 'project-goal-metadata',
      });
    });

    it('coerces a non-numeric ProjectGoal override to the fallback', async () => {
      const settings = createFakeSystemSettings();
      const { accessor } = createFakeProjectGoalAccessor({
        'resource-A': {
          id: 'goal-1',
          resourceScopeId: 'scope-1',
          metadata: { [PROJECT_GOAL_OVERRIDE_METADATA_KEY]: 'not-a-number' },
        },
      });
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        source: 'project-goal-metadata',
      });
    });

    it('falls back to the default when the accessor throws', async () => {
      const settings = createFakeSystemSettings();
      const accessor: IProjectGoalOverrideAccessor = {
        getOverrideByResourceId: vi.fn(() =>
          Promise.reject(new Error('upstream unreachable')),
        ),
      };
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        source: 'default',
      });
    });

    it('NoopProjectGoalOverrideAccessor always returns null', async () => {
      const accessor = new NoopProjectGoalOverrideAccessor();
      const result = await accessor.getOverrideByResourceId('resource-A');
      expect(result).toBeNull();
    });
  });

  describe('startup baseline priming', () => {
    // Suppress the noisy warn/log output the priming path produces on
    // the throw / no-service cases so the test runner stays quiet
    // when we deliberately exercise the failure branch. Restored in
    // `afterEach` so no other describe block inherits the spy.
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('seeds the baseline from the latest MemorySettingChanged row and reports no drift on the first resolve()', async () => {
      // Prior event payload reflects a runtime drift from the
      // default to a global system setting — the exact shape the
      // service emits. The priming path must convert this row's
      // `(value, source)` tuple into the internal baseline.
      const priorEntry = createMemorySettingChangedEntry({
        id: 'prior-event-1',
        payloadOverrides: {
          newValue: 0.5,
          newSource: 'global-system-setting',
          previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
          previousSource: 'default',
        },
      });
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, findLatestMemorySettingChangedByPayloadSource } =
        createFakeEventLedger();
      findLatestMemorySettingChangedByPayloadSource.mockResolvedValueOnce(
        priorEntry,
      );

      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      const first = await service.resolve('resource-A');

      // The seeded baseline must appear as `previous*` on the next
      // resolve — that's the central invariant the priming path
      // preserves: change detection survives process restarts.
      expect(first).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: 0.5,
        previousSource: 'global-system-setting',
      });
      // Filter narrows by the literal source constant emitted by
      // this service — confirm the priming path passed it through.
      expect(
        findLatestMemorySettingChangedByPayloadSource,
      ).toHaveBeenCalledWith({
        source: 'distillation-threshold.service.resolve',
      });
    });

    it('leaves the baseline null when the ledger has no matching row', async () => {
      // Empty ledger — `findLatestMemorySettingChangedByPayloadSource`
      // resolves to `null` (the default for the fake). Priming must
      // leave the baseline untouched so the first `resolve()` reports
      // the legacy `previousValue: null, previousSource: null` shape.
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger } = createFakeEventLedger();

      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: null,
        previousSource: null,
      });
    });

    it('swallows ledger read errors, logs a warning, and leaves baseline null', async () => {
      // Simulate an outage: the lookup throws. Priming must catch
      // the error, log it via the Nest logger (so operators can
      // observe ledger flakiness), and degrade to a null baseline
      // — distillation scheduling cannot be blocked by a ledger
      // outage, matching the existing `emitBestEffort` contract.
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, findLatestMemorySettingChangedByPayloadSource } =
        createFakeEventLedger();
      findLatestMemorySettingChangedByPayloadSource.mockRejectedValueOnce(
        new Error('ledger unreachable'),
      );

      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: null,
        previousSource: null,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to prime distillation threshold baseline from EventLedger',
        ),
      );
    });

    it('handles the @Optional() EventLedger path without throwing', async () => {
      // The constructor accepts an optional `eventLedger`. When no
      // service is wired (legacy / not-yet-initialised scenarios),
      // `primeBaselineFromLedger()` must short-circuit cleanly and
      // leave the baseline null. `resolve()` then falls through to
      // the existing first-call-as-baseline semantics.
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
      );

      await service.primeBaselineFromLedger();
      const result = await service.resolve('resource-A');

      expect(result).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: null,
        previousSource: null,
      });
      // No ledger means no warning — the @Optional() path is not an
      // error state, it's a deployment shape.
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to prime distillation threshold baseline from EventLedger',
        ),
      );
    });

    it('excludes rows written by SystemSettingsService.setAndEmit via the payload.source filter', async () => {
      // The OTHER producer of `memory.setting.changed.v1` is
      // `SystemSettingsService.setAndEmit`, which writes a payload
      // with `source = 'system-settings.setAndEmit'` and does NOT
      // emit `previousSource` / `newSource`. The ledger lookup
      // filters by `payload.source`, so those rows are excluded —
      // even though they share the same event name. This test
      // simulates that exclusion at the service boundary by
      // configuring the fake to resolve `null` for the priming
      // lookup (matching the real filter behaviour).
      //
      // Design choice: the filter narrows by `payload.source`, NOT
      // by `newSource`. Justification: `payload.source` identifies
      // the producer, while `newSource` describes the tier a
      // DRIFT-detection tuple landed at. Two different concerns;
      // only `payload.source` is a stable producer discriminator
      // because every writer is required to set it.
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, findLatestMemorySettingChangedByPayloadSource } =
        createFakeEventLedger();
      // Real-eventledger behaviour: SystemSettingsService rows are
      // excluded by the source filter, so the lookup resolves null.
      // (The fake already defaults to null; the explicit
      // `mockResolvedValueOnce` makes the intent visible to the
      // reader.)
      findLatestMemorySettingChangedByPayloadSource.mockResolvedValueOnce(null);

      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      const result = await service.resolve('resource-A');

      // Without a primed baseline, the first resolve establishes
      // the baseline locally — `changed: false, previous*: null`.
      expect(result).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: null,
        previousSource: null,
      });
    });

    it('is re-entrant: a second concurrent priming call reuses the in-flight promise', async () => {
      // Trigger an intentional delay on the first call so the
      // second call arrives mid-flight and must coalesce onto the
      // same promise — the priming path must not start parallel
      // ledger reads.
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, findLatestMemorySettingChangedByPayloadSource } =
        createFakeEventLedger();
      let resolveFirst:
        | ((value: MemorySettingChangedLedgerEntry | null) => void)
        | null = null;
      findLatestMemorySettingChangedByPayloadSource.mockImplementationOnce(
        () =>
          new Promise<MemorySettingChangedLedgerEntry | null>((resolve) => {
            resolveFirst = resolve;
          }),
      );
      findLatestMemorySettingChangedByPayloadSource.mockResolvedValueOnce(
        createMemorySettingChangedEntry({
          id: 'never-resolved',
        }),
      );

      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      const first = service.primeBaselineFromLedger();
      const second = service.primeBaselineFromLedger();

      expect(
        findLatestMemorySettingChangedByPayloadSource,
      ).toHaveBeenCalledTimes(1);

      // Unblock the in-flight read; the coalesced second call
      // should resolve once the first settles.
      resolveFirst?.(null);
      await Promise.all([first, second]);

      expect(
        findLatestMemorySettingChangedByPayloadSource,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-replica convergence', () => {
    it('two services seeded from the same ledger row return identical no-drift verdicts', async () => {
      // Central invariant of the refactor: the baseline must be
      // sourced from the shared EventLedger, not from
      // independent process-local state. Two service instances,
      // each with its OWN EventLedgerService fake wired to a
      // shared upstream ledger, must both seed to the same
      // `(value, source)` and therefore return the same
      // `changed: false` verdict on the same input.
      const sharedEntry = createMemorySettingChangedEntry({
        id: 'shared-prior-event',
        occurredAt: new Date('2026-04-30T00:05:00.000Z'),
        payloadOverrides: {
          newValue: 0.45,
          newSource: 'global-system-setting',
          previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
          previousSource: 'default',
        },
      });

      const sharedSettingsConfig: Record<string, FakeSettingsEntry> = {
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.45 },
      };

      function buildReplica(): {
        service: DistillationThresholdService;
        findLatest: ReturnType<typeof vi.fn>;
      } {
        const settings = createFakeSystemSettings(sharedSettingsConfig);
        const { accessor } = createFakeProjectGoalAccessor();
        const { ledger, findLatestMemorySettingChangedByPayloadSource } =
          createFakeEventLedger();
        findLatestMemorySettingChangedByPayloadSource.mockResolvedValue(
          sharedEntry,
        );
        const service = new DistillationThresholdService(
          settings.service,
          accessor,
          ledger,
        );
        return {
          service,
          findLatest: findLatestMemorySettingChangedByPayloadSource,
        };
      }

      const replicaA = buildReplica();
      const replicaB = buildReplica();

      await Promise.all([
        replicaA.service.primeBaselineFromLedger(),
        replicaB.service.primeBaselineFromLedger(),
      ]);

      const [resolutionA, resolutionB] = await Promise.all([
        replicaA.service.resolve('resource-A'),
        replicaB.service.resolve('resource-A'),
      ]);

      expect(resolutionA.changed).toBe(false);
      expect(resolutionB.changed).toBe(false);
      expect(resolutionA).toMatchObject({
        value: 0.45,
        source: 'global-system-setting',
        previousValue: 0.45,
        previousSource: 'global-system-setting',
      });
      expect(resolutionB).toEqual(resolutionA);
      // Two separate ledger fakes must each have read the row —
      // confirms each replica independently consults its own
      // ledger connection rather than sharing cached state.
      expect(replicaA.findLatest).toHaveBeenCalledTimes(1);
      expect(replicaB.findLatest).toHaveBeenCalledTimes(1);
    });
  });

  describe('drift detection against a primed baseline', () => {
    // The pre-existing per-tick drift tests drive the
    // change-detection logic via the natural first-call seeder.
    // These tests re-assert the same behaviour against the
    // EventLedger-primed baseline (the M2 refactor introduces
    // two paths to populate `baseline`: a live resolve() or a
    // priming read on startup). The drift detector must treat
    // both paths identically — `previousValue` /
    // `previousSource` must come from the most recent tuple in
    // either source, not from process-local memory of a previous
    // resolve call.
    it('reports no drift on the first resolve when the primed baseline matches the configured value', async () => {
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, findLatestMemorySettingChangedByPayloadSource } =
        createFakeEventLedger();
      findLatestMemorySettingChangedByPayloadSource.mockResolvedValue(
        createMemorySettingChangedEntry({
          payloadOverrides: {
            newValue: 0.5,
            newSource: 'global-system-setting',
            previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
            previousSource: 'default',
          },
        }),
      );
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      const first = await service.resolve('resource-A');

      expect(first).toMatchObject({
        value: 0.5,
        source: 'global-system-setting',
        changed: false,
        previousValue: 0.5,
        previousSource: 'global-system-setting',
      });
    });

    it('reports drift on the second resolve when the configured value moves away from the primed baseline', async () => {
      // Prime from a row whose tuple is (0.5, global-system-setting).
      // Then change the global override to 0.45 — the second resolve
      // must compare against the primed baseline (0.5) rather than
      // against a process-local cache of the first resolve.
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const {
        ledger,
        emitBestEffort,
        findLatestMemorySettingChangedByPayloadSource,
      } = createFakeEventLedger();
      findLatestMemorySettingChangedByPayloadSource.mockResolvedValue(
        createMemorySettingChangedEntry({
          payloadOverrides: {
            newValue: 0.5,
            newSource: 'global-system-setting',
            previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
            previousSource: 'default',
          },
        }),
      );
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      await service.resolve('resource-A');
      configureSettings(settings, {
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: 0.45,
      });
      const second = await service.resolve('resource-A');

      expect(second).toMatchObject({
        value: 0.45,
        source: 'global-system-setting',
        changed: true,
        // `previousValue` / `previousSource` reference the primed
        // baseline — the drift path replaces the in-process cache
        // with the latest live resolution, which is (0.45).
        previousValue: 0.5,
        previousSource: 'global-system-setting',
      });
      expect(emitBestEffort).toHaveBeenCalledTimes(1);
      expect(emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            previousValue: 0.5,
            previousSource: 'global-system-setting',
            newValue: 0.45,
            newSource: 'global-system-setting',
          }),
        }),
      );
    });

    it('does not call the ledger again on resolve once the baseline is primed', async () => {
      // The priming read is a one-shot. Resolve() must NOT trigger
      // additional ledger reads — it reads the primed tuple from
      // process-local memory. This guards against an accidental
      // regression where the resolver might re-query the ledger
      // per call (which would be expensive and bypass the in-memory
      // cache the refactor is built around).
      const settings = createFakeSystemSettings({
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: { value: 0.5 },
      });
      const { accessor } = createFakeProjectGoalAccessor();
      const { ledger, findLatestMemorySettingChangedByPayloadSource } =
        createFakeEventLedger();
      findLatestMemorySettingChangedByPayloadSource.mockResolvedValue(
        createMemorySettingChangedEntry({
          payloadOverrides: {
            newValue: 0.5,
            newSource: 'global-system-setting',
            previousValue: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
            previousSource: 'default',
          },
        }),
      );
      const service = new DistillationThresholdService(
        settings.service,
        accessor,
        ledger,
      );

      await service.primeBaselineFromLedger();
      await service.resolve('resource-A');
      await service.resolve('resource-A');

      expect(
        findLatestMemorySettingChangedByPayloadSource,
      ).toHaveBeenCalledTimes(1);
    });
  });
});

describe('coerceMemoryDistillationThreshold', () => {
  it('returns the value when it is in range', () => {
    expect(coerceMemoryDistillationThreshold(0.5)).toBe(0.5);
    expect(coerceMemoryDistillationThreshold(0.1)).toBe(0.1);
    expect(coerceMemoryDistillationThreshold(0.95)).toBe(0.95);
  });

  it('returns the fallback when the value is below the minimum', () => {
    expect(coerceMemoryDistillationThreshold(0.05)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(-0.5)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(0.05, 0.42)).toBe(0.42);
  });

  it('returns the fallback when the value is above the maximum', () => {
    expect(coerceMemoryDistillationThreshold(1.0)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(0.96)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(2, 0.6)).toBe(0.6);
  });

  it('returns the fallback for non-numeric values', () => {
    expect(coerceMemoryDistillationThreshold('0.5')).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold('high')).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(true)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold({ value: 0.5 })).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold([0.5])).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
  });

  it('returns the fallback for NaN and Infinity', () => {
    expect(coerceMemoryDistillationThreshold(NaN)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(Infinity)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(-Infinity)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
  });

  it('returns the fallback for null and undefined', () => {
    expect(coerceMemoryDistillationThreshold(null)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(undefined)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold(undefined, 0.7)).toBe(0.7);
  });

  it('falls back to the default when the supplied fallback is not a finite number', () => {
    expect(coerceMemoryDistillationThreshold('garbage', NaN)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
    expect(coerceMemoryDistillationThreshold('garbage', Infinity)).toBe(
      MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
    );
  });
});
