import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  refreshRepositoryWorkflowsSchema,
  WorkflowRepositoryController,
} from './workflow-repository.controller';
import type { RepositoryWorkflowDiscoveryService } from './repository-workflow-discovery.service';

describe('WorkflowRepositoryController', () => {
  const refreshRepositoryWorkflows = vi.fn();
  let controller: WorkflowRepositoryController;

  const discoveryService = {
    refreshRepositoryWorkflows,
  } as unknown as RepositoryWorkflowDiscoveryService;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new WorkflowRepositoryController(discoveryService);
  });

  it('delegates refresh requests to the discovery service and returns the result', async () => {
    const expectedResult = { discovered: 3, upserted: 3, disabled: 0 };
    refreshRepositoryWorkflows.mockResolvedValue(expectedResult);

    const result = await controller.refreshRepositoryWorkflows({
      scopeId: 'scope-1',
      rootPath: '/repos/project-1',
    });

    expect(refreshRepositoryWorkflows).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      rootPath: '/repos/project-1',
    });
    expect(result).toEqual(expectedResult);
  });

  it('passes optional sourceRef through to the discovery service', async () => {
    const expectedResult = { discovered: 2, upserted: 1, disabled: 1 };
    refreshRepositoryWorkflows.mockResolvedValue(expectedResult);

    const result = await controller.refreshRepositoryWorkflows({
      scopeId: 'scope-2',
      rootPath: '/repos/project-2',
      sourceRef: 'main',
    });

    expect(refreshRepositoryWorkflows).toHaveBeenCalledWith({
      scopeId: 'scope-2',
      rootPath: '/repos/project-2',
      sourceRef: 'main',
    });
    expect(result).toEqual(expectedResult);
  });

  it('rejects an empty scopeId', () => {
    const pipe = new ZodValidationPipe(refreshRepositoryWorkflowsSchema);

    expect(() =>
      pipe.transform(
        { scopeId: '', rootPath: '/repos/project-1' },
        { type: 'body' },
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an empty rootPath', () => {
    const pipe = new ZodValidationPipe(refreshRepositoryWorkflowsSchema);

    expect(() =>
      pipe.transform({ scopeId: 'scope-1', rootPath: '' }, { type: 'body' }),
    ).toThrow(BadRequestException);
  });

  it('rejects a request missing both required fields', () => {
    const pipe = new ZodValidationPipe(refreshRepositoryWorkflowsSchema);

    expect(() => pipe.transform({}, { type: 'body' })).toThrow(
      BadRequestException,
    );
  });

  it('accepts a valid payload without sourceRef', () => {
    const pipe = new ZodValidationPipe(refreshRepositoryWorkflowsSchema);

    const result = pipe.transform(
      { scopeId: 'scope-1', rootPath: '/repos/project-1' },
      { type: 'body' },
    );

    expect(result).toEqual({
      scopeId: 'scope-1',
      rootPath: '/repos/project-1',
    });
  });

  it('accepts a valid payload with optional sourceRef', () => {
    const pipe = new ZodValidationPipe(refreshRepositoryWorkflowsSchema);

    const result = pipe.transform(
      { scopeId: 'scope-1', rootPath: '/repos/project-1', sourceRef: 'main' },
      { type: 'body' },
    );

    expect(result).toEqual({
      scopeId: 'scope-1',
      rootPath: '/repos/project-1',
      sourceRef: 'main',
    });
  });
});
