import { describe, expect, it, vi } from 'vitest';
import { ReadPlaybookTool } from './read-playbook.tool';
import { ReadSkillManifestTool } from './read-skill-manifest.tool';
import { SearchPlaybooksTool } from './search-playbooks.tool';
import { SearchSkillsTool } from './search-skills.tool';
import { ReadWorkflowSummaryTool } from '../workflow/read-workflow-summary.tool';
import { SearchWorkflowsTool } from '../workflow/search-workflows.tool';

describe('advisor discovery tools', () => {
  it('registers the workflow discovery tool names used by the Advisor seed', async () => {
    const workflowTools = {
      searchWorkflows: vi.fn().mockResolvedValue({ workflows: [], total: 0 }),
      readWorkflowSummary: vi
        .fn()
        .mockResolvedValue({ workflow: { workflow_id: 'wf' } }),
    };
    const search = new SearchWorkflowsTool(workflowTools as never);
    const read = new ReadWorkflowSummaryTool(workflowTools as never);

    expect(search.getName()).toBe('search_workflows');
    expect(read.getName()).toBe('read_workflow_summary');
    expect(search.getDefinition()).toMatchObject({
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: expect.arrayContaining(['read_only', 'context']),
    });
    expect(read.getDefinition()).toMatchObject({
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: expect.arrayContaining(['read_only', 'context']),
    });

    await search.execute({}, { query: 'advisor' });
    await read.execute({}, { workflow_id: 'wf' });

    expect(workflowTools.searchWorkflows).toHaveBeenCalledWith({
      query: 'advisor',
    });
    expect(workflowTools.readWorkflowSummary).toHaveBeenCalledWith('wf');
  });

  it('searches seeded skill and playbook manifests used by the Advisor seed', async () => {
    const tools = [
      new SearchSkillsTool(),
      new ReadSkillManifestTool(),
      new SearchPlaybooksTool(),
      new ReadPlaybookTool(),
    ];

    expect(tools.map((tool) => tool.getName()).sort()).toEqual([
      'read_playbook',
      'read_skill_manifest',
      'search_playbooks',
      'search_skills',
    ]);
    for (const tool of tools) {
      expect(tool.getDefinition()).toMatchObject({
        transport: 'api_callback',
        runtimeOwner: 'api',
        policyTags: expect.arrayContaining(['read_only', 'context']),
      });
    }

    await expect(
      tools[0]?.execute({}, { query: 'test driven' }),
    ).resolves.toMatchObject({
      total: expect.any(Number),
      skills: expect.arrayContaining([
        expect.objectContaining({ name: 'test-driven-development' }),
      ]),
    });
    await expect(
      tools[1]?.execute({}, { skill_name: 'test-driven-development' }),
    ).resolves.toMatchObject({
      found: true,
      skill: expect.objectContaining({
        name: 'test-driven-development',
        content: expect.stringContaining('# Test-Driven Development'),
      }),
    });
    await expect(
      tools[2]?.execute({}, { query: 'next cycle' }),
    ).resolves.toMatchObject({
      total: expect.any(Number),
      playbooks: expect.arrayContaining([
        expect.objectContaining({ name: 'next-cycle-planning' }),
      ]),
    });
    await expect(
      tools[3]?.execute({}, { playbook_id: 'next-cycle-planning' }),
    ).resolves.toMatchObject({
      found: true,
      playbook: expect.objectContaining({
        name: 'next-cycle-planning',
        content: expect.stringContaining('# Next Cycle Planning'),
      }),
    });
  });
});
