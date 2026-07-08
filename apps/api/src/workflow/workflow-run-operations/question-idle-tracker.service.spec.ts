import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionIdleTrackerService } from './question-idle-tracker.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';

describe('QuestionIdleTrackerService', () => {
  let service: QuestionIdleTrackerService;
  const onStopMock = vi.fn().mockResolvedValue(undefined);
  const onRemoveMock = vi.fn().mockResolvedValue(undefined);

  const settings = {
    get: vi.fn(),
  } as unknown as SystemSettingsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: stop after 300s, remove after 3600s
    vi.mocked(settings.get).mockImplementation(
      async (key: string, defaultValue: unknown) => {
        if (key === 'question_idle_stop_seconds') return 300;
        if (key === 'question_idle_remove_seconds') return 3600;
        return defaultValue;
      },
    );

    service = new QuestionIdleTrackerService(settings);
    service.registerCallbacks({ onStop: onStopMock, onRemove: onRemoveMock });
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('fires stop callback after configured idle seconds', async () => {
    await service.trackQuestionsPosed('run-1', 'container-1');

    vi.advanceTimersByTime(300_000); // 300 seconds

    expect(onStopMock).toHaveBeenCalledWith('run-1', 'container-1');
    expect(onRemoveMock).not.toHaveBeenCalled();
  });

  it('fires remove callback after configured remove seconds', async () => {
    await service.trackQuestionsPosed('run-1', 'container-1');

    vi.advanceTimersByTime(3_600_000); // 3600 seconds

    expect(onRemoveMock).toHaveBeenCalledWith('run-1', 'container-1');
  });

  it('clears timers when clearTracking is called', async () => {
    await service.trackQuestionsPosed('run-1', 'container-1');

    service.clearTracking('run-1');

    vi.advanceTimersByTime(4_000_000);

    expect(onStopMock).not.toHaveBeenCalled();
    expect(onRemoveMock).not.toHaveBeenCalled();
  });

  it('reports tracking status correctly', async () => {
    expect(service.isTracking('run-1')).toBe(false);

    await service.trackQuestionsPosed('run-1', 'container-1');
    expect(service.isTracking('run-1')).toBe(true);

    service.clearTracking('run-1');
    expect(service.isTracking('run-1')).toBe(false);
  });

  it('replaces existing tracking when trackQuestionsPosed is called again', async () => {
    await service.trackQuestionsPosed('run-1', 'container-1');

    // Advance partially
    vi.advanceTimersByTime(200_000);

    // Re-track with new container — should reset timers
    await service.trackQuestionsPosed('run-1', 'container-2');

    // Advance past original stop time but not new one
    vi.advanceTimersByTime(200_000);
    expect(onStopMock).not.toHaveBeenCalled();

    // Advance to new stop time
    vi.advanceTimersByTime(100_000);
    expect(onStopMock).toHaveBeenCalledWith('run-1', 'container-2');
  });

  it('cleans up all timers on module destroy', async () => {
    await service.trackQuestionsPosed('run-1', 'container-1');
    await service.trackQuestionsPosed('run-2', 'container-2');

    service.onModuleDestroy();

    vi.advanceTimersByTime(4_000_000);

    expect(onStopMock).not.toHaveBeenCalled();
    expect(onRemoveMock).not.toHaveBeenCalled();
  });

  it('uses configured settings values', async () => {
    vi.mocked(settings.get).mockImplementation(async (key: string) => {
      if (key === 'question_idle_stop_seconds') return 60;
      if (key === 'question_idle_remove_seconds') return 120;
      return 0;
    });

    await service.trackQuestionsPosed('run-1', 'container-1');

    vi.advanceTimersByTime(60_000);
    expect(onStopMock).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(60_000);
    expect(onRemoveMock).toHaveBeenCalledOnce();
  });
});
