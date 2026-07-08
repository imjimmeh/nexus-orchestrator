import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SystemSettingsService,
  SYSTEM_SETTING_DEFAULTS,
} from './system-settings.service';
import {
  WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
  WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
} from './repair-delegation-settings.constants';
import {
  MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
  MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
  MEMORY_DISTILLATION_THRESHOLD_KEY_PREFIX,
  MEMORY_DISTILLATION_THRESHOLD_MAX,
  MEMORY_DISTILLATION_THRESHOLD_MIN,
} from './distillation-threshold.constants';
import type { SystemSettingsRepository } from './system-settings.repository';
import type { SystemSetting } from '../system/database/entities/system-setting.entity';

describe('SystemSettingsService', () => {
  let service: SystemSettingsService;

  const findAllMock = vi.fn();
  const findByKeyMock = vi.fn();
  const upsertMock = vi.fn();

  const repository = {
    findAll: findAllMock,
    findByKey: findByKeyMock,
    upsert: upsertMock,
  } as unknown as SystemSettingsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new SystemSettingsService(repository);
  });

  it('includes default system settings', () => {
    expect(SYSTEM_SETTING_DEFAULTS).toEqual(
      expect.objectContaining({
        question_idle_stop_seconds: expect.objectContaining({
          value: 300,
        }),
        question_idle_remove_seconds: expect.objectContaining({
          value: 3600,
        }),
        scheduled_jobs_enabled: expect.objectContaining({
          value: true,
        }),
        scheduled_jobs_poll_interval_seconds: expect.objectContaining({
          value: 30,
        }),
        scheduled_jobs_poll_batch_size: expect.objectContaining({
          value: 50,
        }),
        workflow_auto_retry_enabled: expect.objectContaining({
          value: false,
        }),
        workflow_auto_retry_max_attempts: expect.objectContaining({
          value: 2,
        }),
        workflow_auto_retry_initial_delay_ms: expect.objectContaining({
          value: 60000,
        }),
        workflow_auto_retry_max_delay_ms: expect.objectContaining({
          value: 300000,
        }),
        workflow_auto_retry_backoff_multiplier: expect.objectContaining({
          value: 2,
        }),
        workflow_auto_retry_jitter_ratio: expect.objectContaining({
          value: 0.2,
        }),
        workflow_auto_retry_max_in_flight: expect.objectContaining({
          value: 5,
        }),
        chat_session_auto_retry_enabled: expect.objectContaining({
          value: true,
        }),
        chat_session_auto_retry_max_attempts: expect.objectContaining({
          value: 5,
        }),
        chat_session_auto_retry_initial_delay_ms: expect.objectContaining({
          value: 60000,
        }),
        chat_session_auto_retry_max_delay_ms: expect.objectContaining({
          value: 3600000,
        }),
        chat_session_auto_retry_backoff_multiplier: expect.objectContaining({
          value: 2,
        }),
        chat_session_auto_retry_reset_buffer_ms: expect.objectContaining({
          value: 60000,
        }),
        chat_session_auto_retry_max_in_flight: expect.objectContaining({
          value: 20,
        }),
        [WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING]: expect.objectContaining({
          value: true,
        }),
        [WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING]:
          expect.objectContaining({
            value: 1,
          }),
        agent_war_room_required_signoff_roles: expect.objectContaining({
          value: ['architect', 'dev', 'qa'],
        }),
        agent_war_room_deadlock_signoff_threshold: expect.objectContaining({
          value: 3,
        }),
        agent_war_room_auto_ceo_tie_break: expect.objectContaining({
          value: false,
        }),
        agent_war_room_max_message_chars: expect.objectContaining({
          value: 4000,
        }),
        [MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY]: expect.objectContaining({
          value: MEMORY_DISTILLATION_THRESHOLD_DEFAULT,
        }),
      }),
    );
  });

  it('exposes the memory distillation threshold default with bounded range description', () => {
    const entry =
      SYSTEM_SETTING_DEFAULTS[MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY];
    expect(entry).toBeDefined();
    expect(entry.value).toBe(MEMORY_DISTILLATION_THRESHOLD_DEFAULT);
    expect(entry.description).toContain(
      String(MEMORY_DISTILLATION_THRESHOLD_MIN),
    );
    expect(entry.description).toContain(
      String(MEMORY_DISTILLATION_THRESHOLD_MAX),
    );
  });

  it('exposes the learning convergence window days default with bounded range description (milestone 3)', () => {
    const entry = SYSTEM_SETTING_DEFAULTS['learning_convergence_window_days'];
    expect(entry).toBeDefined();
    expect(entry.value).toBe(7);
    expect(entry.description).toContain('1-90');
  });

  it('includes EPIC-066 stage skill policy defaults', () => {
    const rawPolicy = SYSTEM_SETTING_DEFAULTS.workflow_stage_skill_policy
      .value as Record<string, unknown>;
    const discovery = rawPolicy.discovery as Record<string, unknown>;
    const implementation = rawPolicy.implementation as Record<string, unknown>;
    const review = rawPolicy.review as Record<string, unknown>;
    const ceoDiscoveryRule = discovery['ceo-agent'] as Record<string, unknown>;
    const seniorImplementationRule = implementation.senior_dev as Record<
      string,
      unknown
    >;
    const qaReviewRule = review.qa_automation as Record<string, unknown>;

    expect(ceoDiscoveryRule.exclude_skills).toEqual(
      expect.arrayContaining(['test-driven-development', 'refactoring']),
    );
    expect(seniorImplementationRule.include_skills).toEqual(
      expect.arrayContaining(['test-driven-development', 'dependency-updater']),
    );
    expect(qaReviewRule.include_skills).toEqual(
      expect.arrayContaining(['test-driven-development']),
    );
  });

  describe('get', () => {
    it('returns stored value when key exists', async () => {
      findByKeyMock.mockResolvedValue({
        key: 'question_idle_stop_seconds',
        value: 600,
      });

      const result = await service.get('question_idle_stop_seconds', 300);

      expect(result).toBe(600);
      expect(findByKeyMock).toHaveBeenCalledWith('question_idle_stop_seconds');
    });

    it('returns default value when key is absent', async () => {
      findByKeyMock.mockResolvedValue(null);

      const result = await service.get('unknown_key', 42);

      expect(result).toBe(42);
    });
  });

  describe('set', () => {
    it('delegates to repository upsert', async () => {
      const setting = {
        key: 'foo',
        value: 'bar',
        description: 'A test setting',
        updatedAt: new Date(),
      } as SystemSetting;
      upsertMock.mockResolvedValue(setting);

      const result = await service.set('foo', 'bar', 'A test setting');

      expect(result).toBe(setting);
      expect(upsertMock).toHaveBeenCalledWith('foo', 'bar', 'A test setting');
    });

    it('passes undefined description when omitted', async () => {
      upsertMock.mockResolvedValue({});

      await service.set('foo', 123);

      expect(upsertMock).toHaveBeenCalledWith('foo', 123, undefined);
    });
  });

  describe('getAll', () => {
    it('returns all settings from repository', async () => {
      const settings = [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
      ] as SystemSetting[];
      findAllMock.mockResolvedValue(settings);

      const result = await service.getAll();

      expect(result).toEqual(settings);
      expect(findAllMock).toHaveBeenCalledOnce();
    });
  });

  describe('setAndEmit (memory setting audit hook)', () => {
    it('emits a MemorySettingChanged event for memory-distillation keys when the value changes', async () => {
      const emit = vi.fn().mockResolvedValue(undefined);
      const eventLedger = { emitBestEffort: emit } as never;
      const serviceWithLedger = new SystemSettingsService(
        repository,
        eventLedger,
      );
      findByKeyMock.mockResolvedValue({ value: 0.7 });
      upsertMock.mockResolvedValue({
        key: MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
        value: 0.6,
      });

      await serviceWithLedger.setAndEmit(
        MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
        0.6,
        'updated',
        'admin-user',
      );

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'memory',
          eventName: 'memory.setting.changed.v1',
          outcome: 'success',
          actorId: 'admin-user',
          payload: expect.objectContaining({
            key: MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
            previousValue: 0.7,
            newValue: 0.6,
            source: 'system-settings.setAndEmit',
          }),
        }),
      );
    });

    it('does not emit when the value is structurally identical to the prior value', async () => {
      const emit = vi.fn().mockResolvedValue(undefined);
      const eventLedger = { emitBestEffort: emit } as never;
      const serviceWithLedger = new SystemSettingsService(
        repository,
        eventLedger,
      );
      findByKeyMock.mockResolvedValue({ value: 0.6 });
      upsertMock.mockResolvedValue({
        key: MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
        value: 0.6,
      });

      await serviceWithLedger.setAndEmit(
        MEMORY_DISTILLATION_THRESHOLD_GLOBAL_KEY,
        0.6,
      );

      expect(emit).not.toHaveBeenCalled();
    });

    it('does not emit for non-memory keys (e.g. RBAC enforcement mode)', async () => {
      const emit = vi.fn().mockResolvedValue(undefined);
      const eventLedger = { emitBestEffort: emit } as never;
      const serviceWithLedger = new SystemSettingsService(
        repository,
        eventLedger,
      );
      findByKeyMock.mockResolvedValue({ value: 'audit' });
      upsertMock.mockResolvedValue({
        key: 'rbac_enforcement_mode.__global__',
        value: 'enforce',
      });

      await serviceWithLedger.setAndEmit(
        'rbac_enforcement_mode.__global__',
        'enforce',
      );

      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('seedDefaults', () => {
    it('creates missing default settings', async () => {
      findByKeyMock.mockResolvedValue(null);
      upsertMock.mockResolvedValue({});

      await service.seedDefaults();

      const defaultKeys = Object.keys(SYSTEM_SETTING_DEFAULTS);
      expect(findByKeyMock).toHaveBeenCalledTimes(defaultKeys.length);
      expect(upsertMock).toHaveBeenCalledTimes(defaultKeys.length);

      for (const key of defaultKeys) {
        const def = SYSTEM_SETTING_DEFAULTS[key];
        expect(upsertMock).toHaveBeenCalledWith(
          key,
          def.value,
          def.description,
        );
      }
    });

    it('skips existing settings during seed', async () => {
      findByKeyMock.mockResolvedValue({
        key: 'question_idle_stop_seconds',
        value: 999,
      });

      await service.seedDefaults();

      expect(upsertMock).not.toHaveBeenCalled();
    });
  });
});
