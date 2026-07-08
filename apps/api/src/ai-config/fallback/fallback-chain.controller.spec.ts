import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { FallbackChainsController } from '../controllers/fallback-chains.controller';
import type { FallbackChainRepository } from '../database/repositories/fallback-chain.repository';
import type { ProviderCooldownRepository } from '../database/repositories/provider-cooldown.repository';
import type { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import type { LlmModelRepository } from '../database/repositories/llm-model.repository';

describe('FallbackChainsController', () => {
  let chains: {
    findByName: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  let cooldowns: { findActive: ReturnType<typeof vi.fn> };
  let providers: { findByName: ReturnType<typeof vi.fn> };
  let models: { findByName: ReturnType<typeof vi.fn> };
  let controller: FallbackChainsController;

  beforeEach(() => {
    chains = {
      findByName: vi.fn(),
      upsert: vi.fn(),
    };
    cooldowns = { findActive: vi.fn() };
    providers = { findByName: vi.fn() };
    models = { findByName: vi.fn() };
    controller = new FallbackChainsController(
      chains as unknown as FallbackChainRepository,
      cooldowns as unknown as ProviderCooldownRepository,
      providers as unknown as LlmProviderRepository,
      models as unknown as LlmModelRepository,
    );
  });

  describe('GET /ai-config/fallback-chains/global', () => {
    it('returns a default empty chain when none is configured', async () => {
      chains.findByName.mockResolvedValue(null);
      const result = await controller.getGlobalChain();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'default', entries: [] });
    });

    it('returns the configured default chain', async () => {
      const entity = {
        name: 'default',
        entries: [{ provider_name: 'anthropic', model_name: 'claude-3' }],
      };
      chains.findByName.mockResolvedValue(entity);
      const result = await controller.getGlobalChain();
      expect(result.success).toBe(true);
      expect(result.data.entries).toHaveLength(1);
      expect(result.data.entries[0].provider_name).toBe('anthropic');
    });
  });

  describe('PUT /ai-config/fallback-chains/global', () => {
    it('rejects an entry with an unknown provider', async () => {
      providers.findByName.mockResolvedValue(null);
      await expect(
        controller.putGlobalChain({
          entries: [{ provider_name: 'nope', model_name: 'm' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an entry with an unknown model', async () => {
      providers.findByName.mockResolvedValue({ id: 'p1', name: 'anthropic' });
      models.findByName.mockResolvedValue(null);
      await expect(
        controller.putGlobalChain({
          entries: [
            { provider_name: 'anthropic', model_name: 'unknown-model' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('upserts and returns the updated chain when entries are valid', async () => {
      const entry = { provider_name: 'anthropic', model_name: 'claude-3' };
      providers.findByName.mockResolvedValue({ id: 'p1', name: 'anthropic' });
      models.findByName.mockResolvedValue({ id: 'm1', name: 'claude-3' });
      chains.upsert.mockResolvedValue({ name: 'default', entries: [entry] });

      const result = await controller.putGlobalChain({ entries: [entry] });

      expect(chains.upsert).toHaveBeenCalledWith('default', [entry]);
      expect(result.success).toBe(true);
      expect(result.data.entries).toHaveLength(1);
    });

    it('accepts an empty entries array (clears the chain)', async () => {
      chains.upsert.mockResolvedValue({ name: 'default', entries: [] });
      const result = await controller.putGlobalChain({ entries: [] });
      expect(result.success).toBe(true);
      expect(result.data.entries).toHaveLength(0);
    });
  });

  describe('GET /ai-config/provider-cooldowns', () => {
    it('maps active cooldowns to status DTOs', async () => {
      cooldowns.findActive.mockResolvedValue([
        {
          provider_name: 'a',
          reason: 'usage_exhausted',
          cooled_until: new Date('2026-06-29T01:00:00Z'),
          last_failure_at: new Date('2026-06-29T00:00:00Z'),
          source_run_id: 'run-1',
        },
      ]);
      const result = await controller.getProviderCooldowns();
      expect(result.success).toBe(true);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          provider_name: 'a',
          reason: 'usage_exhausted',
        }),
      );
    });

    it('returns ISO-8601 strings for date fields', async () => {
      cooldowns.findActive.mockResolvedValue([
        {
          provider_name: 'b',
          reason: 'auth_failed',
          cooled_until: new Date('2026-06-29T02:00:00Z'),
          last_failure_at: new Date('2026-06-29T01:00:00Z'),
          source_run_id: null,
        },
      ]);
      const result = await controller.getProviderCooldowns();
      expect(result.success).toBe(true);
      expect(result.data[0].cooled_until).toBe('2026-06-29T02:00:00.000Z');
      expect(result.data[0].last_failure_at).toBe('2026-06-29T01:00:00.000Z');
    });

    it('returns an empty array when no cooldowns are active', async () => {
      cooldowns.findActive.mockResolvedValue([]);
      const result = await controller.getProviderCooldowns();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('preserves source_run_id including null', async () => {
      cooldowns.findActive.mockResolvedValue([
        {
          provider_name: 'c',
          reason: 'provider_outage',
          cooled_until: new Date('2026-06-29T03:00:00Z'),
          last_failure_at: new Date('2026-06-29T02:30:00Z'),
          source_run_id: null,
        },
      ]);
      const result = await controller.getProviderCooldowns();
      expect(result.success).toBe(true);
      expect(result.data[0].source_run_id).toBeNull();
    });
  });
});
