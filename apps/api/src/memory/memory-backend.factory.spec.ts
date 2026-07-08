import { describe, expect, it, vi } from 'vitest';
import { MemoryBackendFactory } from './memory-backend.factory';
import { ConfigService } from '@nestjs/config';
import { MemoryBackend } from './memory-backend.types';

function createBackendStub(): any {
  return {
    createMemorySegment: vi.fn(),
    getMemorySegments: vi.fn(),
    getMemorySegmentsByType: vi.fn(),
    updateMemorySegment: vi.fn(),
    deleteMemorySegment: vi.fn(),
    searchMemory: vi.fn(),
    searchMemoryByType: vi.fn(),
  };
}

describe('MemoryBackendFactory', () => {
  it('selects postgres by default', () => {
    const configService = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const factory = new MemoryBackendFactory(configService);
    const postgres = createBackendStub();
    const honcho = createBackendStub();
    const dual = createBackendStub();

    expect(factory.create({ postgres, honcho, dual })).toBe(postgres);
  });

  it('selects honcho mode', () => {
    const configService = {
      get: vi.fn().mockReturnValue('honcho'),
    } as unknown as ConfigService;

    const factory = new MemoryBackendFactory(configService);
    const postgres = createBackendStub();
    const honcho = createBackendStub();
    const dual = createBackendStub();

    expect(factory.create({ postgres, honcho, dual })).toBe(honcho);
  });

  it('selects dual mode', () => {
    const configService = {
      get: vi.fn().mockReturnValue('dual'),
    } as unknown as ConfigService;

    const factory = new MemoryBackendFactory(configService);
    const postgres = createBackendStub();
    const honcho = createBackendStub();
    const dual = createBackendStub();

    expect(factory.create({ postgres, honcho, dual })).toBe(dual);
  });
});
