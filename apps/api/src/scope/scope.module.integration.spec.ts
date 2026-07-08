import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScopeService } from './scope.service';
import { ScopeNode } from './database/entities/scope-node.entity';
import { DataSource } from 'typeorm';

describe('ScopeModule wiring', () => {
  it('resolves ScopeService', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScopeService,
        {
          provide: getRepositoryToken(ScopeNode),
          useValue: { query: async () => [] },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: async (cb: any) =>
              cb({ query: async () => [{ id: 'x' }] }),
          },
        },
      ],
    }).compile();
    expect(moduleRef.get(ScopeService)).toBeInstanceOf(ScopeService);
  });
});
