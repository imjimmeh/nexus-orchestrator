import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SearchWorkflowsTool } from './search-workflows.tool';
import { WorkflowMetaToolsHandler } from '../../handlers/workflow-meta-tools.handler';

describe('SearchWorkflowsTool', () => {
  let tool: SearchWorkflowsTool;
  let handler: WorkflowMetaToolsHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchWorkflowsTool,
        {
          provide: WorkflowMetaToolsHandler,
          useValue: {
            searchWorkflows: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<SearchWorkflowsTool>(SearchWorkflowsTool);
    handler = module.get<WorkflowMetaToolsHandler>(WorkflowMetaToolsHandler);
  });

  it('getName() should return search_workflows', () => {
    expect(tool.getName()).toBe('search_workflows');
  });

  it('execute() should call handler.searchWorkflows', async () => {
    const params = { query: 'test' };
    await tool.execute({}, params);
    expect(handler.searchWorkflows).toHaveBeenCalledWith(params);
  });
});
