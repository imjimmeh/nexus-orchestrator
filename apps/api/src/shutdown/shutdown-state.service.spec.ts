import { ShutdownStateService } from './shutdown-state.service';

describe('ShutdownStateService', () => {
  it('reports false until shutdown begins, true after', () => {
    const svc = new ShutdownStateService();
    expect(svc.isShuttingDown()).toBe(false);
    svc.onApplicationShutdown();
    expect(svc.isShuttingDown()).toBe(true);
  });
});
