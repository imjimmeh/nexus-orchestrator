import { describe, it, expect, afterEach } from 'vitest';
import {
  containerUrlsConfig,
  CONTAINER_URLS_CONFIG,
} from './container-urls.config';

describe('containerUrlsConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads values from environment variables', () => {
    process.env.WEBSOCKET_URL = 'http://ws:3001';
    process.env.API_BASE_URL = 'http://api:3000';
    process.env.NEXUS_DOCKER_NETWORK = 'my-network';

    const result = containerUrlsConfig();

    expect(result.websocketUrl).toBe('http://ws:3001');
    expect(result.apiBaseUrl).toBe('http://api:3000');
    expect(result.dockerNetwork).toBe('my-network');
  });

  it('uses defaults when env vars are absent', () => {
    delete process.env.WEBSOCKET_URL;
    delete process.env.API_BASE_URL;
    delete process.env.NEXUS_DOCKER_NETWORK;

    const result = containerUrlsConfig();

    expect(result.websocketUrl).toBe('http://host.docker.internal:3001');
    expect(result.apiBaseUrl).toBe('http://nexus-api:3000');
    expect(result.dockerNetwork).toBe('nexus-network');
  });

  it('exports the correct config namespace token', () => {
    expect(CONTAINER_URLS_CONFIG).toBe('containerUrls');
  });
});
