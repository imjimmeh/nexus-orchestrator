import { describe, expect, it, vi } from 'vitest';
import { DAGResolverService } from './dag-resolver.service';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowValidationService } from './workflow-validation.service';
import type { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import type { SpecialStepHandlerLookup } from './workflow-special-steps/step-special-step.types';
import type { AgentSkillsService } from '../ai-config/services/agent-skills.service';

/**
 * Task 5: the workflow YAML `skills:` surface (workflow-level + step-level).
 * Exercises the real parser (`WorkflowParserService.parseWorkflow`) and the
 * real deep validator (`WorkflowValidationService.validateWorkflow`) end to
 * end, since these are the exact entrypoints the Task 4 executor/subagent
 * wiring reads (`workflowYamlSkills` from `IWorkflowDefinition.skills`,
 * `stepYamlSkills` from a job's `inputs.skills`).
 */
describe('workflow YAML skills surface', () => {
  const parser = new WorkflowParserService();

  function buildValidator(
    knownSkillNames: string[],
  ): WorkflowValidationService {
    const toolRegistryRepo = {
      findByName: vi.fn().mockResolvedValue({ id: 'tool-1', name: 'read' }),
    } as unknown as ToolRegistryRepository;
    const dagResolver = new DAGResolverService();
    const specialStepRegistry: SpecialStepHandlerLookup = {
      getHandler: vi.fn().mockReturnValue(null),
    };
    const agentSkills = {
      listSkills: vi
        .fn()
        .mockReturnValue(knownSkillNames.map((name) => ({ name }))),
    } as unknown as AgentSkillsService;

    return new WorkflowValidationService(
      toolRegistryRepo,
      dagResolver,
      specialStepRegistry,
      agentSkills,
    );
  }

  it('parses workflow-level and step-level skills', () => {
    const yaml = `
workflow_id: demo_workflow
name: demo
skills: [global-skill]
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      skills: [step-skill]
`;

    const parsed = parser.parseWorkflow(yaml);

    expect(parsed.skills).toEqual(['global-skill']);
    expect(parsed.jobs?.[0]?.inputs?.skills).toEqual(['step-skill']);
  });

  it('parses a workflow with no skills declared exactly as before (backward compatible)', () => {
    const yaml = `
workflow_id: demo_workflow_no_skills
name: demo
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`;

    const parsed = parser.parseWorkflow(yaml);

    expect(parsed.skills).toBeUndefined();
    expect(parsed.jobs?.[0]?.inputs?.skills).toBeUndefined();
  });

  it('rejects a malformed workflow-level skills block at parse time', () => {
    const yaml = `
workflow_id: demo_workflow_bad_skills
name: demo
skills: not-an-array
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`;

    expect(() => parser.parseWorkflow(yaml)).toThrow(/skills/i);
  });

  it('rejects a malformed step-level inputs.skills block at parse time', () => {
    const yaml = `
workflow_id: demo_workflow_bad_step_skills
name: demo
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      skills: [42]
`;

    expect(() => parser.parseWorkflow(yaml)).toThrow(/skills/i);
  });

  it('warns (does not throw/error) on an unknown workflow-level skill name', async () => {
    const yaml = `
workflow_id: demo_workflow_unknown_skill
name: demo
skills: [does-not-exist]
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`;
    const parsed = parser.parseWorkflow(yaml);
    const validator = buildValidator([]);

    const result = await validator.validateWorkflow(parsed);

    expect(result.warnings.some((w) => /does-not-exist/.test(w))).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('warns on an unknown step-level skill name and not on a known one', async () => {
    const yaml = `
workflow_id: demo_workflow_step_skill
name: demo
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
      skills: [known-skill, unknown-skill]
`;
    const parsed = parser.parseWorkflow(yaml);
    const validator = buildValidator(['known-skill']);

    const result = await validator.validateWorkflow(parsed);

    expect(
      result.warnings.some((w) => /unknown-skill/.test(w) && /build/.test(w)),
    ).toBe(true);
    expect(result.warnings.some((w) => /'known-skill'/.test(w))).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it('produces no skill warnings for a workflow with no skills declared', async () => {
    const yaml = `
workflow_id: demo_workflow_no_skills_validate
name: demo
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`;
    const parsed = parser.parseWorkflow(yaml);
    const validator = buildValidator([]);

    const result = await validator.validateWorkflow(parsed);

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
