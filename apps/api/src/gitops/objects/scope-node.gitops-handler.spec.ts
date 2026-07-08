import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { ScopeNodeGitopsHandler } from './scope-node.gitops-handler';
import { DataSource } from 'typeorm';
import { ScopeService } from '../../scope/scope.service';

describe('ScopeNodeGitopsHandler', () => {
  it('normalizes and serializes scope nodes', async () => {
    const dataSource = {
      query: vi.fn().mockResolvedValue([]),
    } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['scope-1']),
    } as any;
    const handler = new ScopeNodeGitopsHandler(dataSource, scope);

    expect(handler.objectType).toBe('scope_node');
    expect(
      handler.normalizeDesired({
        objectType: 'scope_node',
        key: '/acme',
        fields: { name: 'Acme', slug: 'acme', type: 'org' },
      }),
    ).toEqual({
      objectType: 'scope_node',
      key: '/acme',
      fields: { name: 'Acme', slug: 'acme', type: 'org' },
    });
  });

  it('can be constructed by Nest with injected dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScopeNodeGitopsHandler,
        { provide: DataSource, useValue: { query: vi.fn() } },
        {
          provide: ScopeService,
          useValue: {
            getDescendantIds: vi.fn(),
            getTree: vi.fn(),
            createNode: vi.fn(),
          },
        },
      ],
    }).compile();

    expect(moduleRef.get(ScopeNodeGitopsHandler)).toBeInstanceOf(
      ScopeNodeGitopsHandler,
    );
  });
});
