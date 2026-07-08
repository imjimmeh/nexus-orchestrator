import { describe, it, expect, vi } from 'vitest';
import { ProviderOAuthController } from './provider-oauth.controller';

describe('ProviderOAuthController', () => {
  const mockService = {
    createAuthorizationUrl: vi.fn(),
    getStatus: vi.fn(),
    completeCallback: vi.fn(),
  };

  const controller = new ProviderOAuthController(mockService as any);

  describe('authorize', () => {
    it('delegates to service and wraps authorization URL result', async () => {
      mockService.createAuthorizationUrl.mockResolvedValue({
        authorizationUrl: 'https://provider.example/auth',
        state: 'state',
      });

      const result = await controller.authorize('provider-1', {
        redirect_uri: 'http://localhost:3120/providers/oauth/callback',
      });

      expect(result).toEqual({
        success: true,
        data: {
          authorizationUrl: 'https://provider.example/auth',
          state: 'state',
        },
      });
      expect(mockService.createAuthorizationUrl).toHaveBeenCalledWith({
        providerId: 'provider-1',
        redirectUri: 'http://localhost:3120/providers/oauth/callback',
      });
    });

    it('delegates without redirect_uri when not provided', async () => {
      mockService.createAuthorizationUrl.mockResolvedValue({
        authorizationUrl: 'https://provider.example/auth',
        state: 'state',
      });

      const result = await controller.authorize('provider-1', {});

      expect(result).toEqual({
        success: true,
        data: {
          authorizationUrl: 'https://provider.example/auth',
          state: 'state',
        },
      });
      expect(mockService.createAuthorizationUrl).toHaveBeenCalledWith({
        providerId: 'provider-1',
        redirectUri: undefined,
      });
    });
  });

  describe('callback', () => {
    it('delegates to service and wraps connected result', async () => {
      mockService.completeCallback.mockResolvedValue({ status: 'connected' });

      const result = await controller.callback({
        code: 'code-1',
        state: 'random-state-value-with-min-32-chars',
      });

      expect(result).toEqual({
        success: true,
        data: { status: 'connected' },
      });
      expect(mockService.completeCallback).toHaveBeenCalledWith({
        code: 'code-1',
        state: 'random-state-value-with-min-32-chars',
      });
    });
  });

  describe('status', () => {
    it('delegates to service and returns connected status', async () => {
      mockService.getStatus.mockResolvedValue({ status: 'connected' });

      const result = await controller.status('provider-1');

      expect(result).toEqual({
        success: true,
        data: { status: 'connected' },
      });
      expect(mockService.getStatus).toHaveBeenCalledWith('provider-1');
    });

    it('delegates to service and returns not_configured status', async () => {
      mockService.getStatus.mockResolvedValue({ status: 'not_configured' });

      const result = await controller.status('unknown-provider');

      expect(result).toEqual({
        success: true,
        data: { status: 'not_configured' },
      });
    });

    it('delegates to service and returns expired status', async () => {
      mockService.getStatus.mockResolvedValue({ status: 'expired' });

      const result = await controller.status('provider-1');

      expect(result).toEqual({
        success: true,
        data: { status: 'expired' },
      });
    });
  });
});
