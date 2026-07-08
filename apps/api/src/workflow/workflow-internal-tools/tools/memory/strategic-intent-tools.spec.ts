import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import {
  RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
  READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
} from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import type { InternalToolExecutionContext } from '@nexus/core';
import { INTERNAL_TOOL_HANDLER } from '../../../../tool/internal-tool.tokens';
import { RecordStrategicIntentHandler } from '../../handlers/record-strategic-intent.handler';
import { ReadStrategicIntentHandler } from '../../handlers/read-strategic-intent.handler';
import { WorkflowInternalToolsModule } from '../../workflow-internal-tools.module';
import { ReadStrategicIntentTool } from './read-strategic-intent.tool';
import { RecordStrategicIntentTool } from './record-strategic-intent.tool';

describe('RecordStrategicIntentTool', () => {
  it('exposes the record_strategic_intent runtime capability', () => {
    const tool = new RecordStrategicIntentTool(
      {} as RecordStrategicIntentHandler,
    );

    expect(tool.getName()).toBe('record_strategic_intent');
    expect(tool.getDefinition()).toBe(
      RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
    );
  });

  it('delegates execution to the memory tools handler', async () => {
    const context: InternalToolExecutionContext = {
      workflowRunId: 'run-ctx',
      jobId: 'job-ctx',
    };
    const params = {
      entity_type: 'Project',
      entity_id: 'project-1',
      intent: {
        horizon: 'Q1-2026',
        priority_themes: ['memory schema coverage'],
        focus_areas: ['strategic intent tool wiring'],
        constraints: ['no silent lint regressions'],
      },
    };
    const writeResult = {
      entity_type: 'Project',
      entity_id: 'project-1',
      segment_id: 'segment-1',
      version: 1,
      memory_type: 'strategic_intent',
      updated_at: '2026-06-19T12:00:00.000Z',
      intent: {
        ...params.intent,
        updated_at: '2026-06-19T12:00:00.000Z',
        updated_by: 'ceo',
      },
    };
    const recordStrategicIntent = vi.fn().mockResolvedValue(writeResult);
    const memoryTools = {
      recordStrategicIntent,
    } as unknown as RecordStrategicIntentHandler;
    const tool = new RecordStrategicIntentTool(memoryTools);

    const result = await tool.execute(context, params);

    expect(recordStrategicIntent).toHaveBeenCalledWith(params);
    expect(result).toBe(writeResult);
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

    expect(providers).toContain(RecordStrategicIntentTool);
    expect(internalToolProvider?.inject).toContain(RecordStrategicIntentTool);
  });
});

describe('ReadStrategicIntentTool', () => {
  it('exposes the read_strategic_intent runtime capability', () => {
    const tool = new ReadStrategicIntentTool({} as ReadStrategicIntentHandler);

    expect(tool.getName()).toBe('read_strategic_intent');
    expect(tool.getDefinition()).toBe(READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY);
  });

  it('delegates execution to the memory tools handler and returns the structured intent', async () => {
    const params = {
      entity_type: 'Project',
      entity_id: 'project-1',
    };
    const readResult = {
      entity_type: 'Project',
      entity_id: 'project-1',
      found: true,
      segment_id: 'segment-1',
      version: 1,
      updated_at: '2026-06-19T12:00:00.000Z',
      intent: {
        horizon: 'Q1-2026',
        priority_themes: ['memory schema coverage'],
        focus_areas: ['strategic intent tool wiring'],
        constraints: ['no silent lint regressions'],
        updated_at: '2026-06-19T12:00:00.000Z',
        updated_by: 'ceo',
      },
    };
    const readStrategicIntent = vi.fn().mockResolvedValue(readResult);
    const memoryTools = {
      readStrategicIntent,
    } as unknown as ReadStrategicIntentHandler;
    const tool = new ReadStrategicIntentTool(memoryTools);

    const result = await tool.execute(
      { workflowRunId: 'run-ctx', jobId: 'job-ctx' },
      params,
    );

    expect(readStrategicIntent).toHaveBeenCalledWith(params);
    expect(result).toBe(readResult);
    expect((result as { intent: Record<string, unknown> }).intent.horizon).toBe(
      'Q1-2026',
    );
  });

  it('returns the empty-intent shape when no segment has been recorded yet', async () => {
    const readResult = {
      entity_type: 'Project',
      entity_id: 'never-recorded',
      found: false,
      intent: null,
    };
    const readStrategicIntent = vi.fn().mockResolvedValue(readResult);
    const memoryTools = {
      readStrategicIntent,
    } as unknown as ReadStrategicIntentHandler;
    const tool = new ReadStrategicIntentTool(memoryTools);

    const result = await tool.execute(
      { workflowRunId: 'run-ctx', jobId: 'job-ctx' },
      { entity_type: 'Project', entity_id: 'never-recorded' },
    );

    expect(result).toEqual({
      entity_type: 'Project',
      entity_id: 'never-recorded',
      found: false,
      intent: null,
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

    expect(providers).toContain(ReadStrategicIntentTool);
    expect(internalToolProvider?.inject).toContain(ReadStrategicIntentTool);
  });
});
