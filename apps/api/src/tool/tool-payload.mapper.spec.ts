import { describe, expect, it } from 'vitest';
import { ToolPayloadMapper } from '../tool-registry/tool-payload.mapper';

describe('ToolPayloadMapper', () => {
  it('maps camelCase capability payload fields in create payloads', () => {
    const mapper = new ToolPayloadMapper();

    const payload = mapper.toCreatePayload({
      name: 'set_job_output',
      schema: { type: 'object' },
      typescript_code: 'export const tool = {}',
      tierRestriction: 1,
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/jobs/set-output',
        bodyMapping: { data: 'data' },
      },
    });

    expect(payload.tier_restriction).toBe(1);
    expect(payload.api_callback).toEqual({
      method: 'POST',
      path_template: '/api/workflow-runtime/jobs/set-output',
      body_mapping: { data: 'data' },
    });
  });

  it('maps description and metadata in create payloads', () => {
    const mapper = new ToolPayloadMapper();

    const payload = mapper.toCreatePayload({
      name: 'delegate_goal_backlog_planning',
      description: 'Launch goal backlog planning.',
      metadata: { source: 'workflow_delegation_projection' },
      schema: { type: 'object' },
      typescript_code: 'export const tool = {}',
    });

    expect(payload.description).toBe('Launch goal backlog planning.');
    expect(payload.metadata).toEqual({
      source: 'workflow_delegation_projection',
    });
  });

  it('maps description and metadata in update payloads', () => {
    const mapper = new ToolPayloadMapper();

    const payload = mapper.toUpdatePayload({
      description: 'Updated projected workflow tool.',
      metadata: { projectionId: 'ceo.goal_backlog' },
    });

    expect(payload.description).toBe('Updated projected workflow tool.');
    expect(payload.metadata).toEqual({ projectionId: 'ceo.goal_backlog' });
  });

  it('maps camelCase capability payload fields in update payloads', () => {
    const mapper = new ToolPayloadMapper();

    const payload = mapper.toUpdatePayload({
      tierRestriction: 2,
      apiCallback: {
        method: 'PATCH',
        pathTemplate: '/api/workflow-runtime/jobs/set-output',
      },
    });

    expect(payload.tier_restriction).toBe(2);
    expect(payload.api_callback).toEqual({
      method: 'PATCH',
      path_template: '/api/workflow-runtime/jobs/set-output',
      body_mapping: undefined,
    });
  });
});
