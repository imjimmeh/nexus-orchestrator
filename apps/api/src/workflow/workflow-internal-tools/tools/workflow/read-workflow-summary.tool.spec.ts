import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadWorkflowSummaryTool } from './read-workflow-summary.tool';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

describe('ReadWorkflowSummaryTool', () => {
  let tool: ReadWorkflowSummaryTool;
  let handler: WorkflowMetaToolsHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadWorkflowSummaryTool,
        {
          provide: WorkflowMetaToolsHandler,
          useValue: {
            readWorkflowSummary: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<ReadWorkflowSummaryTool>(ReadWorkflowSummaryTool);
    handler = module.get<WorkflowMetaToolsHandler>(WorkflowMetaToolsHandler);
  });

  it('getName() should return read_workflow_summary', () => {
    expect(tool.getName()).toBe('read_workflow_summary');
  });

  it('execute() should call handler.readWorkflowSummary', async () => {
    const params = { workflow_id: 'test-wf' };
    await tool.execute({}, params);
    expect(handler.readWorkflowSummary).toHaveBeenCalledWith(
      params.workflow_id,
    );
  });
});
