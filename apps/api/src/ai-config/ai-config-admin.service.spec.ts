import { ToolPolicyEffect } from '@nexus/core';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@earendil-works/pi-ai', () => ({
  getProviders: () => ['openai', 'anthropic'],
  getModels: () => [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      api: 'chat',
      baseUrl: 'https://api.openai.com/v1',
      reasoning: false,
      input: ['text'],
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 5, output: 15 },
      thinkingLevelMap: { medium: 'auto', high: 'high' },
    },
  ],
  getModel: () => undefined,
  getSupportedThinkingLevels: () => [],
}));

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthProviders: () => [
    {
      id: 'anthropic',
      name: 'Anthropic',
      login: { toString: () => 'http' },
      usesCallbackServer: false,
    },
  ],
}));

import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiConfigAdminService } from './ai-config-admin.service';
import {
  ProviderCrudService,
  ModelCrudService,
  ProfileCrudService,
} from './services/crud';
import { SecretCrudService } from '../security/services/secret-crud.service';
import { AgentSkillsService } from './services/agent-skills.service';
import { IAMPolicyService } from '../security/iam-policy.service';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { GitOpsEditPolicyService } from '../gitops/gitops-edit-policy.service';
import { GitOpsPendingChangeService } from '../gitops/gitops-pending-change.service';
import { ProviderCredentialService } from './services/provider-credential.service';
import { ThinkingLevelCapabilityService } from './services/thinking-level-capability.service';
import { LlmProviderRepository } from './database/repositories/llm-provider.repository';
import { EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT } from './events/embedding-model.events';

type MockCrudService = {
  findAll: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findByIdOrThrow: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

type MockAgentSkillsService = {
  listSkills: ReturnType<typeof vi.fn>;
  getSkill: ReturnType<typeof vi.fn>;
  createSkill: ReturnType<typeof vi.fn>;
  updateSkill: ReturnType<typeof vi.fn>;
  deleteSkill: ReturnType<typeof vi.fn>;
  listSkillsForProfile: ReturnType<typeof vi.fn>;
  replaceProfileSkills: ReturnType<typeof vi.fn>;
  addProfileSkills: ReturnType<typeof vi.fn>;
  removeProfileSkills: ReturnType<typeof vi.fn>;
};

type MockIamPolicyService = {
  refreshPolicies: ReturnType<typeof vi.fn>;
};

type MockToolRegistryRepository = {
  findAll: ReturnType<typeof vi.fn>;
};

type MockProviderCredentialService = {
  applyOnCreate: ReturnType<typeof vi.fn>;
  applyOnUpdate: ReturnType<typeof vi.fn>;
};

type MockThinkingLevelCapabilityService = {
  getSupportedLevels: ReturnType<typeof vi.fn>;
};

type MockLlmProviderRepository = {
  findByProviderId: ReturnType<typeof vi.fn>;
};

describe('AiConfigAdminService', () => {
  const skillMarkdownFixture =
    '---\nname: review-plan\ndescription: Run review checklist\n---';

  const mockProviderCrud: MockCrudService = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIdOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  const mockModelCrud: MockCrudService = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIdOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  const mockProfileCrud: MockCrudService = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIdOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  const mockSecretCrud: MockCrudService = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIdOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  const mockAgentSkills: MockAgentSkillsService = {
    listSkills: vi.fn(),
    getSkill: vi.fn(),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    listSkillsForProfile: vi.fn(),
    replaceProfileSkills: vi.fn(),
    addProfileSkills: vi.fn(),
    removeProfileSkills: vi.fn(),
  };

  const mockIamPolicy: MockIamPolicyService = {
    refreshPolicies: vi.fn(),
  };

  const mockToolRegistryRepository: MockToolRegistryRepository = {
    findAll: vi.fn(),
  };

  const mockProviderCredentialService: MockProviderCredentialService = {
    applyOnCreate: vi.fn(),
    applyOnUpdate: vi.fn(),
  };

  const mockThinkingLevelCapability: MockThinkingLevelCapabilityService = {
    getSupportedLevels: vi.fn(),
  };

  const mockLlmProviderRepository: MockLlmProviderRepository = {
    findByProviderId: vi.fn(),
  };

  const mockEventEmitter = {
    emit: vi.fn(),
  };

  let providerCredentialService: MockProviderCredentialService;
  let providerCrudService: MockCrudService;

  const mockGitOpsEditPolicy = {
    evaluateExisting: vi.fn(),
    evaluateCreate: vi.fn(),
    assertAllowed: vi.fn(),
  };

  const mockGitOpsPendingChanges = {
    recordConfigObjectChange: vi.fn(),
  };

  let service: AiConfigAdminService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIamPolicy.refreshPolicies.mockResolvedValue(undefined);
    mockThinkingLevelCapability.getSupportedLevels.mockResolvedValue([]);
    mockToolRegistryRepository.findAll.mockResolvedValue([
      { name: 'query_memory' },
      { name: 'read' },
    ]);
    mockLlmProviderRepository.findByProviderId.mockResolvedValue({
      id: 'provider-anthropic',
      name: 'Anthropic',
      provider_id: 'anthropic',
      auth_type: 'oauth',
      oauth_authorization_url: 'https://claude.ai/oauth/authorize',
      oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
      oauth_client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      oauth_redirect_uri: 'http://localhost:53692/callback',
      oauth_scopes: [
        'org:create_api_key',
        'user:profile',
        'user:inference',
        'user:sessions:claude_code',
        'user:mcp_servers',
        'user:file_upload',
      ],
      oauth_client_secret_id: null,
      is_active: true,
    });

    const module = await Test.createTestingModule({
      providers: [
        AiConfigAdminService,
        { provide: ProviderCrudService, useValue: mockProviderCrud },
        { provide: ModelCrudService, useValue: mockModelCrud },
        { provide: ProfileCrudService, useValue: mockProfileCrud },
        { provide: SecretCrudService, useValue: mockSecretCrud },
        { provide: AgentSkillsService, useValue: mockAgentSkills },
        { provide: IAMPolicyService, useValue: mockIamPolicy },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: ToolRegistryRepository,
          useValue: mockToolRegistryRepository,
        },
        { provide: GitOpsEditPolicyService, useValue: mockGitOpsEditPolicy },
        {
          provide: GitOpsPendingChangeService,
          useValue: mockGitOpsPendingChanges,
        },
        {
          provide: ProviderCredentialService,
          useValue: mockProviderCredentialService,
        },
        {
          provide: ThinkingLevelCapabilityService,
          useValue: mockThinkingLevelCapability,
        },
        {
          provide: LlmProviderRepository,
          useValue: mockLlmProviderRepository,
        },
      ],
    }).compile();

    service = module.get(AiConfigAdminService);
    providerCredentialService = module.get(ProviderCredentialService);
    providerCrudService = module.get(ProviderCrudService);
  });

  describe('Provider methods', () => {
    it('delegates listProviders to ProviderCrudService', async () => {
      mockProviderCrud.findAll.mockResolvedValue([{ id: '1', name: 'test' }]);

      const result = await service.listProviders();

      expect(mockProviderCrud.findAll).toHaveBeenCalled();
      expect(result).toEqual([{ id: '1', name: 'test' }]);
    });

    it('getActiveModelRates returns only active models mapped to id/provider/name/rates', async () => {
      mockModelCrud.findAll.mockResolvedValue([
        {
          id: 'model-1',
          name: 'claude-sonnet-5',
          provider_name: 'anthropic',
          input_token_cents_per_million: 300,
          output_token_cents_per_million: 1500,
          is_active: true,
        },
        {
          id: 'model-2',
          name: 'retired-model',
          provider_name: 'openai',
          input_token_cents_per_million: 100,
          output_token_cents_per_million: 200,
          is_active: false,
        },
      ]);

      const result = await service.getActiveModelRates();

      expect(result).toEqual([
        {
          modelId: 'model-1',
          providerName: 'anthropic',
          modelName: 'claude-sonnet-5',
          inputTokenCentsPerMillion: 300,
          outputTokenCentsPerMillion: 1500,
        },
      ]);
    });

    it('delegates getProvider to ProviderCrudService.findByIdOrThrow', async () => {
      mockProviderCrud.findByIdOrThrow.mockResolvedValue({
        id: '1',
        name: 'test',
      });

      const result = await service.getProvider('1');

      expect(mockProviderCrud.findByIdOrThrow).toHaveBeenCalledWith('1');
      expect(result).toEqual({ id: '1', name: 'test' });
    });

    it('throws NotFoundException when provider does not exist', async () => {
      mockProviderCrud.findByIdOrThrow.mockRejectedValue(
        new NotFoundException('Provider with ID missing not found'),
      );

      await expect(service.getProvider('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns a list of provider presets with anthropic OAuth sourced from DB', async () => {
      const result = await service.listProviderPresets();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      const openaiPreset = result.data.find((p) => p.id === 'openai')!;
      expect(openaiPreset).toBeDefined();
      expect(openaiPreset.auth_type).toBe('api_key');
      const anthropicPreset = result.data.find((p) => p.id === 'anthropic') as
        | {
            auth_type: 'oauth';
            oauth_authorization_url: string;
            oauth_token_url: string;
            oauth_scopes: string[];
          }
        | undefined;
      expect(anthropicPreset).toBeDefined();
      expect(anthropicPreset!.auth_type).toBe('oauth');
      expect(anthropicPreset!.oauth_authorization_url).toBe(
        'https://claude.ai/oauth/authorize',
      );
      expect(anthropicPreset!.oauth_token_url).toBe(
        'https://platform.claude.com/v1/oauth/token',
      );
      expect(anthropicPreset!.oauth_scopes).toEqual([
        'org:create_api_key',
        'user:profile',
        'user:inference',
        'user:sessions:claude_code',
        'user:mcp_servers',
        'user:file_upload',
      ]);
      expect(mockLlmProviderRepository.findByProviderId).toHaveBeenCalledWith(
        'anthropic',
      );
    });

    it('returns a list of model presets', async () => {
      const result = await service.listModelPresets();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      const firstModel = result.data[0];
      expect(firstModel).toHaveProperty('id');
      expect(firstModel).toHaveProperty('name');
      expect(firstModel).toHaveProperty('provider');
    });

    it('presets include supportedThinkingLevels and thinkingLevelMap per model', async () => {
      mockThinkingLevelCapability.getSupportedLevels.mockResolvedValue([
        'medium',
        'high',
      ]);

      const result = await service.listModelPresets();

      expect(result.success).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      const firstModel = result.data[0];
      expect(firstModel).toHaveProperty('supportedThinkingLevels');
      expect(firstModel.supportedThinkingLevels).toEqual(['medium', 'high']);
      expect(firstModel).toHaveProperty('thinkingLevelMap');
      expect(
        mockThinkingLevelCapability.getSupportedLevels,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', modelId: 'gpt-4o' }),
      );
    });

    it('runs credential orchestration before creating a provider', async () => {
      const spy = vi
        .spyOn(providerCredentialService, 'applyOnCreate')
        .mockResolvedValue({
          name: 'OpenAI',
          provider_id: 'openai',
          auth_type: 'api_key',
          secret_id: 'secret-1',
          runtime_env: { api_key_field: 'OPENAI_API_KEY' },
        });

      await service.createProvider({
        name: 'OpenAI',
        provider_id: 'openai',
        auth_type: 'api_key',
        credential: { api_key: 'sk-test' },
      });

      expect(spy).toHaveBeenCalled();
      expect(providerCrudService.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ credential: expect.anything() }),
      );
    });

    it('runs credential orchestration before updating a provider', async () => {
      const existingProvider = {
        id: 'provider-1',
        name: 'OpenAI',
        provider_id: 'openai',
        secret_id: 'secret-1',
        runtime_env: { api_key_field: 'OPENAI_API_KEY' },
      };
      mockProviderCrud.findById.mockResolvedValue(existingProvider);
      const spy = vi
        .spyOn(providerCredentialService, 'applyOnUpdate')
        .mockResolvedValue({
          name: 'OpenAI',
          provider_id: 'openai',
          auth_type: 'api_key',
          secret_id: 'secret-1',
          runtime_env: { api_key_field: 'OPENAI_API_KEY' },
        });
      mockProviderCrud.update.mockResolvedValue({
        id: 'provider-1',
        name: 'OpenAI',
        provider_id: 'openai',
        secret_id: 'secret-1',
      });

      await service.updateProvider('provider-1', {
        credential: { api_key: 'sk-new' },
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ credential: expect.anything() }),
        existingProvider,
      );
      expect(providerCrudService.update).toHaveBeenCalledWith(
        'provider-1',
        expect.not.objectContaining({ credential: expect.anything() }),
      );
    });
  });

  describe('Agent profile methods', () => {
    it('creates profiles with admin provenance defaults', async () => {
      mockProfileCrud.create.mockResolvedValue({
        id: 'profile-1',
        name: 'custom-agent',
        source: 'admin',
      });

      await service.createAgentProfile({
        name: 'custom-agent',
        system_prompt: 'You are custom.',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' }],
        },
      });

      expect(mockProfileCrud.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-agent',
          source: 'admin',
          created_by_profile: null,
          created_by_workflow_run_id: null,
          factory_context: null,
        }),
      );
      expect(mockIamPolicy.refreshPolicies).toHaveBeenCalledTimes(1);
    });

    it('forwards provider_id and provider_source to profile crud create', async () => {
      mockProfileCrud.create.mockResolvedValue({
        id: 'profile-2',
        name: 'scoped-agent',
        source: 'admin',
      });

      await service.createAgentProfile({
        name: 'scoped-agent',
        provider_id: 'p-1',
        provider_source: 'user',
      });

      expect(mockProfileCrud.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'scoped-agent',
          provider_id: 'p-1',
          provider_source: 'user',
        }),
      );
    });

    it('refreshes IAM policy cache after updating a profile', async () => {
      mockProfileCrud.findById.mockResolvedValue({
        id: 'profile-1',
        name: 'custom-agent',
        scope_node_id: 'scope-1',
        managedBy: 'manual',
        managedBindingId: null,
        locked: false,
      });
      mockGitOpsEditPolicy.evaluateExisting.mockResolvedValue({
        action: 'allow',
      });
      mockGitOpsEditPolicy.assertAllowed.mockResolvedValue(undefined);
      mockProfileCrud.update.mockResolvedValue({
        id: 'profile-1',
        name: 'custom-agent',
      });

      await service.updateAgentProfile('profile-1', {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
        },
      });

      expect(mockIamPolicy.refreshPolicies).toHaveBeenCalledTimes(1);
    });

    it('records a pending outbound change for two-way profile edits', async () => {
      const binding = { id: 'binding-1', lastAppliedRevision: 'rev-1' };
      mockProfileCrud.findById.mockResolvedValue({
        id: 'profile-1',
        name: 'custom-agent',
        scope_node_id: 'scope-1',
        managedBy: 'gitops',
        managedBindingId: 'binding-1',
        locked: false,
      });
      mockGitOpsEditPolicy.evaluateExisting.mockResolvedValue({
        action: 'allow_with_pending_change',
        binding,
      });
      mockGitOpsEditPolicy.assertAllowed.mockResolvedValue(undefined);
      mockProfileCrud.update.mockResolvedValue({
        id: 'profile-1',
        name: 'custom-agent',
      });

      await service.updateAgentProfile(
        'profile-1',
        { system_prompt: 'updated' },
        'user-1',
      );

      expect(
        mockGitOpsPendingChanges.recordConfigObjectChange,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          binding,
          objectType: 'agent_profile',
          scopeNodeId: 'scope-1',
          name: 'custom-agent',
          changeType: 'update',
          payload: { system_prompt: 'updated' },
          actorId: 'user-1',
        }),
      );
    });

    it('refreshes IAM policy cache after deleting a profile', async () => {
      mockProfileCrud.remove.mockResolvedValue(undefined);

      await service.deleteAgentProfile('profile-1');

      expect(mockIamPolicy.refreshPolicies).toHaveBeenCalledTimes(1);
    });

    it('rejects unknown tools when creating profile', async () => {
      await expect(
        service.createAgentProfile({
          name: 'custom-agent',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'unknown_tool' },
            ],
          },
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockProfileCrud.create).not.toHaveBeenCalled();
    });

    it('allows legacy-prefixed tools during validation', async () => {
      mockProfileCrud.create.mockResolvedValue({
        id: 'profile-1',
        name: 'custom-agent',
        source: 'admin',
      });

      await service.createAgentProfile({
        name: 'custom-agent',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'legacy:missing_tool' },
          ],
        },
      });

      expect(mockProfileCrud.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('Secret methods', () => {
    it('creates encrypted secret and returns sanitized output', async () => {
      mockSecretCrud.create.mockResolvedValue({
        id: 'secret-1',
        name: 'openai',
        metadata: { owner: 'platform' },
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      const result = await service.createSecret({
        name: 'openai',
        value: { OPENAI_API_KEY: 'key-123' },
        metadata: { owner: 'platform' },
      });

      expect(mockSecretCrud.create).toHaveBeenCalledWith({
        name: 'openai',
        value: { OPENAI_API_KEY: 'key-123' },
        metadata: { owner: 'platform' },
      });
      expect(result).toEqual({
        id: 'secret-1',
        name: 'openai',
        metadata: { owner: 'platform' },
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });
      expect(result.encrypted_value).toBeUndefined();
    });

    it('updates secret payload with encryption when value is provided', async () => {
      mockSecretCrud.update.mockResolvedValue({
        id: 'secret-2',
        name: 'anthropic',
        metadata: { rotated: true },
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-02'),
      });

      const result = await service.updateSecret('secret-2', {
        value: { ANTHROPIC_API_KEY: 'key-789' },
        metadata: { rotated: true },
      });

      expect(mockSecretCrud.update).toHaveBeenCalledWith('secret-2', {
        value: { ANTHROPIC_API_KEY: 'key-789' },
        metadata: { rotated: true },
      });
      expect(result.encrypted_value).toBeUndefined();
    });

    it('throws NotFoundException when secret does not exist', async () => {
      mockSecretCrud.findById.mockResolvedValue(null);

      await expect(service.getSecret('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('Agent skill methods', () => {
    it('delegates listAgentSkills to AgentSkillsService', async () => {
      mockAgentSkills.listSkills.mockReturnValue([
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Run review checklist',
          skillMarkdown: skillMarkdownFixture,
          compatibility: null,
          metadata: null,
          source: 'imported',
          version: 1,
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          rootPath: '/skills/review-plan',
        },
      ]);

      const result = service.listAgentSkills();

      expect(mockAgentSkills.listSkills).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([
        expect.objectContaining({
          id: 'skill-1',
          name: 'review-plan',
          is_active: true,
        }),
      ]);
    });

    it('delegates profile assignment replacement to AgentSkillsService', async () => {
      mockAgentSkills.replaceProfileSkills.mockResolvedValue([
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Run review checklist',
          skillMarkdown: skillMarkdownFixture,
          compatibility: null,
          metadata: null,
          source: 'imported',
          version: 2,
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          rootPath: '/skills/review-plan',
        },
      ]);

      const result = await service.replaceSkillsForAgentProfile('profile-1', [
        'skill-1',
      ]);

      expect(mockAgentSkills.replaceProfileSkills).toHaveBeenCalledWith(
        'profile-1',
        ['skill-1'],
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'skill-1',
          name: 'review-plan',
          version: 2,
        }),
      ]);
    });

    it('delegates additive profile skill assignment to AgentSkillsService', async () => {
      mockAgentSkills.addProfileSkills.mockResolvedValue([
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Run review checklist',
          skillMarkdown: skillMarkdownFixture,
          compatibility: null,
          metadata: null,
          source: 'imported',
          version: 2,
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          rootPath: '/skills/review-plan',
        },
      ]);

      const result = await service.addSkillsForAgentProfile('profile-1', [
        'skill-1',
      ]);

      expect(mockAgentSkills.addProfileSkills).toHaveBeenCalledWith(
        'profile-1',
        ['skill-1'],
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'skill-1',
          name: 'review-plan',
          version: 2,
        }),
      ]);
    });

    it('delegates profile skill removal to AgentSkillsService', async () => {
      mockAgentSkills.removeProfileSkills.mockResolvedValue([
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Run review checklist',
          skillMarkdown: skillMarkdownFixture,
          compatibility: null,
          metadata: null,
          source: 'imported',
          version: 3,
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
          rootPath: '/skills/review-plan',
        },
      ]);

      const result = await service.removeSkillsForAgentProfile('profile-1', [
        'debugging',
      ]);

      expect(mockAgentSkills.removeProfileSkills).toHaveBeenCalledWith(
        'profile-1',
        ['debugging'],
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'skill-1',
          name: 'review-plan',
          version: 3,
        }),
      ]);
    });
  });

  describe('Model methods — embedding model change event', () => {
    const modelBase = {
      id: 'model-1',
      name: 'voyage-3',
      default_for_embedding: false,
      embedding_dimension: 384,
      is_active: true,
    } as any;

    beforeEach(() => {
      mockEventEmitter.emit.mockClear();
    });

    it('(m1) emits EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT when default_for_embedding flips to true', async () => {
      mockModelCrud.findById.mockResolvedValue(modelBase);
      mockModelCrud.update.mockResolvedValue({
        ...modelBase,
        default_for_embedding: true,
      });

      await service.updateModel('model-1', { default_for_embedding: true });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT,
        expect.objectContaining({ activeModelId: 'model-1' }),
      );
    });

    it('(m2) does NOT emit when default_for_embedding is unchanged (still false)', async () => {
      mockModelCrud.findById.mockResolvedValue(modelBase);
      mockModelCrud.update.mockResolvedValue({
        ...modelBase,
        name: 'voyage-3-updated',
      });

      await service.updateModel('model-1', { name: 'voyage-3-updated' });

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('(m3) does NOT emit when default_for_embedding was already true and dimension is unchanged', async () => {
      const activeModel = { ...modelBase, default_for_embedding: true };
      mockModelCrud.findById.mockResolvedValue(activeModel);
      mockModelCrud.update.mockResolvedValue({
        ...activeModel,
        name: 'voyage-3-renamed',
      });

      await service.updateModel('model-1', { name: 'voyage-3-renamed' });

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('(m4) emits when embedding_dimension changes on the already-active model', async () => {
      const activeModel = { ...modelBase, default_for_embedding: true };
      mockModelCrud.findById.mockResolvedValue(activeModel);
      mockModelCrud.update.mockResolvedValue({
        ...activeModel,
        embedding_dimension: 1536,
      });

      await service.updateModel('model-1', { embedding_dimension: 1536 });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT,
        expect.objectContaining({ activeModelId: 'model-1' }),
      );
    });

    it('(m5) does NOT emit when dimension changes on a non-active embedding model', async () => {
      mockModelCrud.findById.mockResolvedValue(modelBase); // default_for_embedding: false
      mockModelCrud.update.mockResolvedValue({
        ...modelBase,
        embedding_dimension: 1536,
      });

      await service.updateModel('model-1', { embedding_dimension: 1536 });

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('(m6) maps previousModelId from the pre-update snapshot, distinct from activeModelId', async () => {
      // The helper reads activeModelId from the updated row and previousModelId
      // from the pre-update snapshot. Returning distinct ids proves the two
      // fields are wired to different sources (not aliased to the same value).
      mockModelCrud.findById.mockResolvedValue({
        ...modelBase,
        id: 'model-old',
      });
      mockModelCrud.update.mockResolvedValue({
        ...modelBase,
        id: 'model-new',
        default_for_embedding: true,
      });

      await service.updateModel('model-new', { default_for_embedding: true });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT,
        expect.objectContaining({
          activeModelId: 'model-new',
          previousModelId: 'model-old',
        }),
      );
    });
  });
});
