import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { McpService } from '../../mcp/mcp.service';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
} from '../kernel/interfaces/workflow-kernel.ports';
import { SpecialStepAuditPublisher } from './special-step-audit.publisher';
import { StepHttpWebhookSpecialStepHandler } from './step-http-webhook-special-step.handler';
import { StepInvokeWorkflowSpecialStepHandler } from './step-invoke-workflow-special-step.handler';
import { StepMcpToolCallSpecialStepHandler } from './step-mcp-tool-call-special-step.handler';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';

describe('special step handler dependency graph', () => {
  it('constructs generic core handlers without resolving domain services', async () => {
    const module = await Test.createTestingModule({
      providers: [
        StepInvokeWorkflowSpecialStepHandler,
        StepHttpWebhookSpecialStepHandler,
        StepMcpToolCallSpecialStepHandler,
        {
          provide: SpecialStepAuditPublisher,
          useValue: { audit: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: StepSupportService,
          useValue: {
            resolveInvokedWorkflowId: vi.fn(),
            waitForWorkflowRunCompletion: vi.fn(),
          },
        },
        {
          provide: StepEventPublisherService,
          useValue: {
            publishProcessEvent: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: WORKFLOW_DEFINITION_REPOSITORY_PORT, useValue: {} },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: {} },
        { provide: McpService, useValue: { invokeTool: vi.fn() } },
      ],
    }).compile();

    expect(
      module.get(StepInvokeWorkflowSpecialStepHandler).descriptor.type,
    ).toBe('invoke_workflow');
    expect(module.get(StepHttpWebhookSpecialStepHandler).descriptor.type).toBe(
      'http_webhook',
    );
    expect(module.get(StepMcpToolCallSpecialStepHandler).descriptor.type).toBe(
      'mcp_tool_call',
    );
  });
});
