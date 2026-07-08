import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAutomationSession } from './web-automation.types';
import { WebAutomationPlaywrightDriverService } from './web-automation-playwright-driver.service';
import { WebAutomationSessionStoreService } from './web-automation-session-store.service';

function createSession(id: string): BrowserAutomationSession {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
    page: {
      goto: vi.fn(),
      click: vi.fn(),
      fill: vi.fn(),
      waitForSelector: vi.fn(),
      waitForLoadState: vi.fn(),
      waitForTimeout: vi.fn(),
      content: vi.fn().mockResolvedValue('<html></html>'),
      title: vi.fn().mockResolvedValue('Title'),
      url: vi.fn().mockReturnValue('https://example.com'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    },
  };
}

describe('WebAutomationSessionStoreService', () => {
  const driver = {
    createSession: vi.fn(),
  };

  let service: WebAutomationSessionStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WebAutomationSessionStoreService(
      driver as unknown as WebAutomationPlaywrightDriverService,
    );
  });

  it('opens and returns a session by run and session id', async () => {
    const session = createSession('default');
    driver.createSession.mockResolvedValue(session);

    await service.openSession('run-1', 'default');

    expect(service.getSession('run-1', 'default')).toBe(session);
  });

  it('replaces and closes existing session when opening the same session id', async () => {
    const oldSession = createSession('default');
    const newSession = createSession('default');

    driver.createSession
      .mockResolvedValueOnce(oldSession)
      .mockResolvedValueOnce(newSession);

    await service.openSession('run-1', 'default');
    await service.openSession('run-1', 'default');

    expect(oldSession.close).toHaveBeenCalledTimes(1);
    expect(service.getSession('run-1', 'default')).toBe(newSession);
  });

  it('closes a single session and returns true', async () => {
    const session = createSession('auth');
    driver.createSession.mockResolvedValue(session);

    await service.openSession('run-2', 'auth');
    const closed = await service.closeSession('run-2', 'auth');

    expect(closed).toBe(true);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(service.getSession('run-2', 'auth')).toBeNull();
  });

  it('returns false when closing a missing session', async () => {
    const closed = await service.closeSession('run-3', 'missing');

    expect(closed).toBe(false);
  });

  it('closes all sessions for a run', async () => {
    const a = createSession('a');
    const b = createSession('b');

    driver.createSession.mockResolvedValueOnce(a).mockResolvedValueOnce(b);

    await service.openSession('run-4', 'a');
    await service.openSession('run-4', 'b');

    await service.closeRunSessions('run-4');

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(service.getSession('run-4', 'a')).toBeNull();
    expect(service.getSession('run-4', 'b')).toBeNull();
  });
});
