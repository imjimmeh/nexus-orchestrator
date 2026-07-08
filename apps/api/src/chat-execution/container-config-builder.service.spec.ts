import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerConfigBuilderService } from './container-config-builder.service';
import { ContainerTier, CONTAINER_SESSION_PATH } from '@nexus/core';
import type { ContainerBuildInput } from './container-config-builder.service.types';

describe('ContainerConfigBuilderService', () => {
  let service: ContainerConfigBuilderService;

  const mockConfig = {
    get: (key: string) => {
      const configMap: Record<string, unknown> = {
        containerUrls: {
          websocketUrl: 'http://ws:3001',
          apiBaseUrl: 'http://api:3000',
          dockerNetwork: 'test-net',
        },
      };
      return configMap[key] ?? null;
    },
  };

  beforeEach(() => {
    service = new ContainerConfigBuilderService(mockConfig as any);
  });

  const baseInput: ContainerBuildInput = {
    chatSessionId: 'sess-1',
    agentProfileName: 'default',
    initialMessage: 'hello',
    containerTier: 1,
    agentToken: 'tok-abc',
    toolMountPath: '/tmp/tools',
    aiSettings: {
      model: 'claude-3-5-sonnet',
      systemPrompt: 'You are helpful.',
    },
    providerConfig: {
      provider: 'anthropic',
      apiKey: 'sk-test',
      auth: { type: 'api_key', apiKey: 'sk-test' },
      providerEnv: {},
    },
  };

  it('includes the image name in the container config', () => {
    const config = service.build(baseInput);
    expect(config.image).toBeDefined();
  });

  it('resolves light tier image for containerTier=1', () => {
    const config = service.build(baseInput);
    expect(config.image).toBe('nexus-light:latest');
  });

  it('resolves heavy tier image for containerTier=2', () => {
    const config = service.build({ ...baseInput, containerTier: 2 });
    expect(config.image).toBe('nexus-heavy:latest');
  });

  it('sets CHAT_SESSION_ID in env', () => {
    const config = service.build(baseInput);
    expect(config.env?.['CHAT_SESSION_ID']).toBe('sess-1');
  });

  it('sets AGENT_JWT to the provided token', () => {
    const config = service.build(baseInput);
    expect(config.env?.['AGENT_JWT']).toBe('tok-abc');
  });

  it('sets WEBSOCKET_URL from config', () => {
    const config = service.build(baseInput);
    expect(config.env?.['WEBSOCKET_URL']).toBe('http://ws:3001');
  });

  it('sets API_BASE_URL from config', () => {
    const config = service.build(baseInput);
    expect(config.env?.['API_BASE_URL']).toBe('http://api:3000');
  });

  it('sets MODEL from aiSettings', () => {
    const config = service.build(baseInput);
    expect(config.env?.['MODEL']).toBe('claude-3-5-sonnet');
  });

  it('sets PROVIDER from providerConfig', () => {
    const config = service.build(baseInput);
    expect(config.env?.['PROVIDER']).toBe('anthropic');
  });

  it('sets API_KEY when auth type is api_key', () => {
    const config = service.build(baseInput);
    expect(config.env?.['API_KEY']).toBe('sk-test');
  });

  it('does not set API_KEY when auth type is not api_key', () => {
    const config = service.build({
      ...baseInput,
      providerConfig: {
        ...baseInput.providerConfig,
        auth: {
          type: 'oauth',
          credential: {
            type: 'oauth',
            refreshToken: 'refresh-token',
            accessToken: 'access-token',
            expiresAt: 9999999999,
          },
        },
      },
    });
    expect(config.env?.['API_KEY']).toBeUndefined();
  });

  it('sets tool mount volume binding', () => {
    const config = service.build(baseInput);
    const extVolume = config.volumes?.find(
      (v) => v.containerPath === '/opt/pi-runner/extensions',
    );
    expect(extVolume?.hostPath).toBe('/tmp/tools');
    expect(extVolume?.readOnly).toBe(true);
  });

  it('sets SESSION_PATH so the chat session is extractable by the API', () => {
    const config = service.build(baseInput);
    expect(config.env?.['SESSION_PATH']).toBe(CONTAINER_SESSION_PATH);
  });

  it('sets nexus-managed label', () => {
    const config = service.build(baseInput);
    expect(config.labels?.['nexus.managed']).toBe('true');
  });

  it('sets chat_session_id label', () => {
    const config = service.build(baseInput);
    expect(config.labels?.['nexus.chat_session_id']).toBe('sess-1');
  });

  it('sets tier to LIGHT for containerTier=1', () => {
    const config = service.build(baseInput);
    expect(config.tier).toBe(ContainerTier.LIGHT);
  });

  it('sets tier to HEAVY for containerTier=2', () => {
    const config = service.build({ ...baseInput, containerTier: 2 });
    expect(config.tier).toBe(ContainerTier.HEAVY);
  });
});
