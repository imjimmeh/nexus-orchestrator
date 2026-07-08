import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';

describe('GitOpsRepositoryBindingService', () => {
  const findById = vi.fn();
  const findByScopeNodeId = vi.fn();
  const findAll = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();

  const repository = {
    findById,
    findByScopeNodeId,
    findAll,
    create,
    update,
    remove,
  } as unknown as GitOpsRepositoryBindingRepository;

  let service: GitOpsRepositoryBindingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitOpsRepositoryBindingService(repository);
  });

  it('creates a binding with default ref, root path, and enabled state', async () => {
    const created = {
      id: 'binding-1',
      scopeNodeId: '11111111-1111-1111-1111-111111111111',
      name: 'primary',
      repoUrl: 'https://example.com/repo.git',
      defaultRef: 'main',
      rootPath: '.',
      syncMode: 'git_to_app',
      credentialsSecretId: null,
      enabled: true,
      includedObjectTypes: ['scope_node'],
    };
    create.mockResolvedValue(created);

    const result = await service.create({
      scopeNodeId: '11111111-1111-1111-1111-111111111111',
      name: 'primary',
      repoUrl: 'https://example.com/repo.git',
      syncMode: 'git_to_app',
      includedObjectTypes: ['scope_node'],
    } as any);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeNodeId: '11111111-1111-1111-1111-111111111111',
        name: 'primary',
        repoUrl: 'https://example.com/repo.git',
        defaultRef: 'main',
        rootPath: '.',
        syncMode: 'git_to_app',
        credentialsSecretId: null,
        enabled: true,
        includedObjectTypes: ['scope_node'],
      }),
    );
    expect(result).toEqual(created);
  });

  it('rejects repository URLs with credentials', async () => {
    await expect(
      service.create({
        scopeNodeId: '11111111-1111-1111-1111-111111111111',
        name: 'primary',
        repoUrl: 'https://user:pass@example.com/repo.git',
        syncMode: 'git_to_app',
        includedObjectTypes: ['scope_node'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(create).not.toHaveBeenCalled();
  });

  it('rejects invalid sync modes', async () => {
    await expect(
      service.create({
        scopeNodeId: '11111111-1111-1111-1111-111111111111',
        name: 'primary',
        repoUrl: 'https://example.com/repo.git',
        syncMode: 'cli',
        includedObjectTypes: ['scope_node'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(create).not.toHaveBeenCalled();
  });

  it('updates sync mode from git_to_app to two_way', async () => {
    findById.mockResolvedValue({
      id: 'binding-1',
      scopeNodeId: '11111111-1111-1111-1111-111111111111',
      name: 'primary',
      repoUrl: 'https://example.com/repo.git',
      defaultRef: 'main',
      rootPath: '.',
      syncMode: 'git_to_app',
      credentialsSecretId: null,
      enabled: true,
      includedObjectTypes: ['scope_node'],
    });
    update.mockResolvedValue({
      id: 'binding-1',
      syncMode: 'two_way',
    });

    const result = await service.update(
      'binding-1',
      '11111111-1111-1111-1111-111111111111',
      { syncMode: 'two_way' },
    );

    expect(update).toHaveBeenCalledWith(
      'binding-1',
      expect.objectContaining({ syncMode: 'two_way' }),
    );
    expect(result).toEqual({ id: 'binding-1', syncMode: 'two_way' });
  });

  it('rejects get when the binding scope does not match', async () => {
    findById.mockResolvedValue({
      id: 'binding-1',
      scopeNodeId: '22222222-2222-2222-2222-222222222222',
    });

    await expect(
      service.get('binding-1', '11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects update when the binding scope does not match', async () => {
    findById.mockResolvedValue({
      id: 'binding-1',
      scopeNodeId: '22222222-2222-2222-2222-222222222222',
    });

    await expect(
      service.update('binding-1', '11111111-1111-1111-1111-111111111111', {
        syncMode: 'two_way',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects disable when the binding scope does not match', async () => {
    findById.mockResolvedValue({
      id: 'binding-1',
      scopeNodeId: '22222222-2222-2222-2222-222222222222',
    });

    await expect(
      service.disable('binding-1', '11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(update).not.toHaveBeenCalled();
  });

  it('lists bindings for a scope node', async () => {
    const rows = [
      { id: 'binding-1', scopeNodeId: 'scope-1' },
      { id: 'binding-2', scopeNodeId: 'scope-1' },
    ];
    findByScopeNodeId.mockResolvedValue(rows);

    const result = await service.list('scope-1');

    expect(findByScopeNodeId).toHaveBeenCalledWith('scope-1');
    expect(result).toEqual(rows);
  });

  it('listActive returns only enabled bindings sorted by id ascending', async () => {
    findAll.mockResolvedValue([
      { id: 'binding-c', enabled: true },
      { id: 'binding-a', enabled: false },
      { id: 'binding-b', enabled: true },
    ]);

    const result = await service.listActive();

    expect(findAll).toHaveBeenCalledOnce();
    expect(result.map((binding) => binding.id)).toEqual([
      'binding-b',
      'binding-c',
    ]);
  });
});
