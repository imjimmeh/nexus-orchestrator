import { describe, expect, it } from 'vitest';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';

describe('ServiceLifecycleStateService', () => {
  it('starts in BOOTING and is not accepting work', () => {
    const svc = new ServiceLifecycleStateService();
    expect(svc.phase).toBe('booting');
    expect(svc.isAcceptingWork()).toBe(false);
  });

  it('accepts work only when RUNNING', () => {
    const svc = new ServiceLifecycleStateService();
    svc.markRunning();
    expect(svc.phase).toBe('running');
    expect(svc.isAcceptingWork()).toBe(true);
  });

  it('suspends watchdog reaping while booting or draining', () => {
    const svc = new ServiceLifecycleStateService();
    expect(svc.isReapingSuspended()).toBe(true); // booting
    svc.markRunning();
    expect(svc.isReapingSuspended()).toBe(false);
    svc.markDraining();
    expect(svc.phase).toBe('draining');
    expect(svc.isReapingSuspended()).toBe(true);
  });
});
