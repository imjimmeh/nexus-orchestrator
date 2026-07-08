import { describe, it, expect, vi } from 'vitest';
import { ProvidersController } from './providers.controller';
import { AiConfigAdminService } from '../ai-config-admin.service';
import { ProviderOAuthLinkService } from '../services/provider-oauth-link.service';
import { ScopeAccessService } from '../../auth/authorization/scope-access.service';

describe('ProvidersController', () => {
  const mockAdminService = {
    listProvidersPaginated: vi.fn(),
    listProviderPresets: vi.fn(),
    getProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
  };

  const mockOAuthLink = {
    start: vi.fn(),
    submitCode: vi.fn(),
    sessionStatus: vi.fn(),
  };

  const mockScopeAccess = {
    restrictToAccessibleScopes: vi
      .fn()
      .mockImplementation(
        async (
          _userId: string,
          _permission: string,
          requestedScopeId?: string,
        ) => (requestedScopeId ? [requestedScopeId] : []),
      ),
  };

  const controller = new ProvidersController(
    mockAdminService as unknown as AiConfigAdminService,
    mockOAuthLink as unknown as ProviderOAuthLinkService,
    mockScopeAccess as unknown as ScopeAccessService,
  );

  const REQ = { user: { userId: 'user-1' } } as any;

  describe('listProviders', () => {
    it('confines to the caller accessible scope set when no scopeNodeId given', async () => {
      mockAdminService.listProvidersPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });
      mockScopeAccess.restrictToAccessibleScopes.mockResolvedValue(['team-a']);

      const result = await controller.listProviders(
        { page: 1, limit: 10 } as any,
        REQ,
      );
      expect(result).toEqual({ items: [], total: 0 });
      expect(mockScopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
        'user-1',
        'agents:read',
        undefined,
      );
      expect(mockAdminService.listProvidersPaginated).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        scopeIds: ['team-a'],
      });
    });

    it('confines to a single accessible scopeNodeId', async () => {
      mockAdminService.listProvidersPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });

      await controller.listProviders(
        { page: 1, limit: 10, scopeNodeId: 'team-a' } as any,
        REQ,
      );

      expect(mockAdminService.listProvidersPaginated).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        scopeIds: ['team-a'],
      });
    });

    it('default-denies an out-of-subtree scopeNodeId', async () => {
      mockAdminService.listProvidersPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });
      mockScopeAccess.restrictToAccessibleScopes.mockResolvedValue([]);

      await controller.listProviders(
        { page: 1, limit: 10, scopeNodeId: 'team-out-of-subtree' } as any,
        REQ,
      );

      expect(mockAdminService.listProvidersPaginated).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        scopeIds: [],
      });
    });
  });

  describe('listPresets', () => {
    it('delegates to admin service and returns presets list', async () => {
      const mockPresets = {
        success: true,
        data: [{ id: 'anthropic', name: 'Anthropic', auth_type: 'oauth' }],
      };
      mockAdminService.listProviderPresets.mockResolvedValue(mockPresets);

      const result = await controller.listPresets();
      expect(result).toEqual(mockPresets);
      expect(mockAdminService.listProviderPresets).toHaveBeenCalled();
    });
  });

  describe('getProvider', () => {
    it('delegates to admin service', async () => {
      mockAdminService.getProvider.mockResolvedValue({
        id: '1',
        name: 'Anthropic',
      });

      const result = await controller.getProvider('1');
      expect(result).toEqual({
        success: true,
        data: { id: '1', name: 'Anthropic' },
      });
      expect(mockAdminService.getProvider).toHaveBeenCalledWith('1');
    });
  });

  describe('createProvider', () => {
    it('delegates to admin service', async () => {
      mockAdminService.createProvider.mockResolvedValue({
        id: '1',
        name: 'New',
      });

      const result = await controller.createProvider({ name: 'New' });
      expect(result).toEqual({
        success: true,
        data: { id: '1', name: 'New' },
      });
      expect(mockAdminService.createProvider).toHaveBeenCalledWith({
        name: 'New',
      });
    });
  });

  describe('updateProvider', () => {
    it('delegates to admin service', async () => {
      mockAdminService.updateProvider.mockResolvedValue({
        id: '1',
        name: 'Updated',
      });

      const result = await controller.updateProvider('1', { name: 'Updated' });
      expect(result).toEqual({
        success: true,
        data: { id: '1', name: 'Updated' },
      });
      expect(mockAdminService.updateProvider).toHaveBeenCalledWith('1', {
        name: 'Updated',
      });
    });
  });

  describe('deleteProvider', () => {
    it('delegates to admin service', async () => {
      mockAdminService.deleteProvider.mockResolvedValue(undefined);

      await controller.deleteProvider('1');
      expect(mockAdminService.deleteProvider).toHaveBeenCalledWith('1');
    });
  });

  describe('startOAuth', () => {
    it('delegates to the OAuth link service', async () => {
      const mockResult = {
        sessionId: 'session-xyz',
        modality: 'authcode' as const,
        authorizeUrl: 'https://claude.ai/oauth/authorize',
        expiresAt: new Date(),
      };
      mockOAuthLink.start.mockResolvedValue(mockResult);

      const result = await controller.startOAuth('p-1', {
        enterprise_url: 'http://enterprise.com',
      });

      expect(result).toEqual({ success: true, data: mockResult });
      expect(mockOAuthLink.start).toHaveBeenCalledWith({
        providerId: 'p-1',
        enterpriseUrl: 'http://enterprise.com',
      });
    });
  });

  describe('submitOAuthCode', () => {
    it('delegates to the OAuth link service', async () => {
      const result = await controller.submitOAuthCode('p-1', {
        session_id: 'session-xyz',
        code: 'paste-code',
      });

      expect(result).toEqual({ success: true, data: { accepted: true } });
      expect(mockOAuthLink.submitCode).toHaveBeenCalledWith(
        'session-xyz',
        'paste-code',
      );
    });
  });

  describe('oauthSessionStatus', () => {
    it('delegates to the OAuth link service', () => {
      const mockResult = { status: 'pending' as const };
      mockOAuthLink.sessionStatus.mockReturnValue(mockResult);

      const result = controller.oauthSessionStatus('p-1', 'session-xyz');

      expect(result).toEqual({ success: true, data: mockResult });
      expect(mockOAuthLink.sessionStatus).toHaveBeenCalledWith('session-xyz');
    });
  });
});
