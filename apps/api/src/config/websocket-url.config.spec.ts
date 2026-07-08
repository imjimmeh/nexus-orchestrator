import { describe, it, expect, afterEach } from 'vitest';
import { resolveWebSocketUrl } from './websocket-url.config';

describe('resolveWebSocketUrl', () => {
  const save = { ...process.env };
  afterEach(() => {
    Object.assign(process.env, save);
  });

  it('prefers TELEMETRY_PUBLIC_WS_URL', () => {
    process.env.TELEMETRY_PUBLIC_WS_URL = 'wss://public';
    process.env.TELEMETRY_WS_URL = 'ws://internal';
    process.env.WEBSOCKET_URL = 'ws://fallback';
    expect(resolveWebSocketUrl()).toBe('wss://public');
  });

  it('falls back to TELEMETRY_WS_URL', () => {
    delete process.env.TELEMETRY_PUBLIC_WS_URL;
    process.env.TELEMETRY_WS_URL = 'ws://internal';
    process.env.WEBSOCKET_URL = 'ws://fallback';
    expect(resolveWebSocketUrl()).toBe('ws://internal');
  });

  it('falls back to WEBSOCKET_URL', () => {
    delete process.env.TELEMETRY_PUBLIC_WS_URL;
    delete process.env.TELEMETRY_WS_URL;
    process.env.WEBSOCKET_URL = 'ws://fallback';
    expect(resolveWebSocketUrl()).toBe('ws://fallback');
  });

  it('returns null when nothing is configured', () => {
    delete process.env.TELEMETRY_PUBLIC_WS_URL;
    delete process.env.TELEMETRY_WS_URL;
    delete process.env.WEBSOCKET_URL;
    expect(resolveWebSocketUrl()).toBeNull();
  });
});
