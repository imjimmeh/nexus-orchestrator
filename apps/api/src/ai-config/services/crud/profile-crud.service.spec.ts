import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { ProfileCrudService } from './profile-crud.service';
import { AgentProfileRepository } from '../../database/repositories/agent-profile.repository';
import { AgentProfile } from '../../database/entities/agent-profile.entity';

const mockProfile = (overrides?: Partial<AgentProfile>): AgentProfile =>
  ({
    id: 'profile-1',
    name: 'test-profile',
    source: 'admin',
    is_active: true,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }) as unknown as AgentProfile;

describe('ProfileCrudService', () => {
  let service: ProfileCrudService;
  const repository = {
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileCrudService,
        { provide: AgentProfileRepository, useValue: repository },
      ],
    }).compile();

    service = module.get<ProfileCrudService>(ProfileCrudService);
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('accepts and persists provider_id and provider_source alongside provider_name and model_name', async () => {
      const profile = mockProfile({
        name: 'scoped-profile',
        provider_id: '00000000-0000-4000-8000-000000000001',
        provider_source: 'user',
        provider_name: 'openai',
        model_name: 'gpt-5.5',
      });

      repository.create.mockResolvedValue(profile);

      const result = await service.create({
        name: 'scoped-profile',
        provider_id: '00000000-0000-4000-8000-000000000001',
        provider_source: 'user',
        provider_name: 'openai',
        model_name: 'gpt-5.5',
      });

      expect(result.name).toBe('scoped-profile');
      expect(result.provider_id).toBe('00000000-0000-4000-8000-000000000001');
      expect(result.provider_source).toBe('user');
      expect(result.provider_name).toBe('openai');
      expect(result.model_name).toBe('gpt-5.5');
    });

    it('preserves legacy provider_name and model_name compatibility', async () => {
      const profile = mockProfile({
        name: 'legacy-profile',
        provider_name: 'openai',
        model_name: 'gpt-4',
      });

      repository.create.mockResolvedValue(profile);

      const result = await service.create({
        name: 'legacy-profile',
        provider_name: 'openai',
        model_name: 'gpt-4',
      });

      expect(result.name).toBe('legacy-profile');
      expect(result.provider_name).toBe('openai');
      expect(result.model_name).toBe('gpt-4');
    });
  });

  describe('update', () => {
    it('accepts and persists provider_id and provider_source on update', async () => {
      const updated = mockProfile({
        name: 'test-profile',
        provider_id: '00000000-0000-4000-8000-000000000002',
        provider_source: 'scope',
      });

      repository.update.mockResolvedValue(updated);

      const result = await service.update('profile-1', {
        provider_id: '00000000-0000-4000-8000-000000000002',
        provider_source: 'scope',
      });

      expect(result?.name).toBe('test-profile');
      expect(result?.provider_id).toBe('00000000-0000-4000-8000-000000000002');
      expect(result?.provider_source).toBe('scope');
    });
  });
});
