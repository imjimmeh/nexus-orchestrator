import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import type { InternalToolExecutionContext } from '@nexus/core';
import { INTERNAL_TOOL_HANDLER } from '../../../../tool/internal-tool.tokens';
import { REMEMBER_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { RememberHandler } from '../../handlers/remember.handler';
import { WorkflowInternalToolsModule } from '../../workflow-internal-tools.module';
import { RememberTool } from './remember.tool';

describe('RememberTool', () => {
  it('exposes the remember runtime capability', () => {
    const tool = new RememberTool({} as RememberHandler);

    expect(tool.getName()).toBe('remember');
    expect(tool.getDefinition()).toBe(REMEMBER_RUNTIME_CAPABILITY);
  });

  it('delegates execution to the memory tools handler', async () => {
    const context: InternalToolExecutionContext = {
      workflowRunId: 'run-ctx',
      jobId: 'job-ctx',
      scopeId: 'scope-ctx',
    };
    const params = {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact' as const,
      scope: 'project' as const,
      tags: ['tdd'],
      origin: 'user_request' as const,
      confidence: 0.9,
    };
    const remember = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
    const memoryTools = { remember } as unknown as RememberHandler;
    const tool = new RememberTool(memoryTools);

    const result = await tool.execute(context, params);

    expect(remember).toHaveBeenCalledWith(context, params);
    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
  });

  it('returns the candidate response from the handler on duplicate', async () => {
    const memoryTools = {
      remember: vi.fn().mockResolvedValue({
        status: 'pending',
        candidate_id: 'candidate-1',
        created: false,
        fingerprint: 'fingerprint-1',
      }),
    } as unknown as RememberHandler;
    const tool = new RememberTool(memoryTools);

    const result = await tool.execute(
      { workflowRunId: 'run-ctx', jobId: 'job-ctx' },
      {
        content: 'Always write tests before implementing the feature code.',
        memory_type: 'fact',
        scope: 'project',
        tags: ['tdd'],
        origin: 'discovery',
      },
    );

    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: false,
      fingerprint: 'fingerprint-1',
    });
  });

  it('registers as an internal tool handler provider', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      WorkflowInternalToolsModule,
    ) as unknown[];
    const internalToolProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === INTERNAL_TOOL_HANDLER,
    ) as { inject: unknown[] } | undefined;

    expect(providers).toContain(RememberTool);
    expect(internalToolProvider?.inject).toContain(RememberTool);
  });
});
