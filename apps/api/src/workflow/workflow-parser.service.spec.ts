import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowParserService } from './workflow-parser.service';

describe('WorkflowParserService', () => {
  let service: WorkflowParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowParserService],
    }).compile();

    service = module.get<WorkflowParserService>(WorkflowParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should parse valid YAML with legacy steps format', () => {
    const yaml = `
workflow_id: wf_1
name: Test WF
steps:
  - id: step_1
    type: custom
    `;
    const def = service.parseWorkflow(yaml);
    expect(def.workflow_id).toBe('wf_1');
    expect(def.name).toBe('Test WF');
    expect(def.jobs?.length).toBe(1);
    expect(def.jobs?.[0].id).toBe('step_1');
    expect(def.steps).toBeUndefined();
  });

  it('preserves invoke workflow concurrency skip opt-in when normalizing legacy steps', () => {
    const yaml = `
workflow_id: wf_skip_opt_in
name: Skip Opt In WF
steps:
  - id: invoke_child
    type: invoke_workflow
    tier: light
    workflow_id: child_workflow
    continue_on_concurrency_skip: true
    `;

    const def = service.parseWorkflow(yaml);

    expect(def.jobs?.[0]?.continue_on_concurrency_skip).toBe(true);
  });

  it('should parse valid YAML with new jobs format', () => {
    const yaml = `
workflow_id: wf_2
name: Test WF 2
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: Test prompt
    `;
    const def = service.parseWorkflow(yaml);
    expect(def.workflow_id).toBe('wf_2');
    expect(def.name).toBe('Test WF 2');
    expect(def.jobs?.length).toBe(1);
    expect(def.jobs?.[0].id).toBe('job_1');
    expect(def.jobs?.[0]?.steps?.length).toBe(1);
  });

  it('should extract template variables', () => {
    const yaml = `
global_env:
  URL: "{{trigger.url}}"
  KEY: "{{ trigger.key }}"
    `;
    const vars = service.extractTemplateVariables(yaml);
    expect(vars).toContain('trigger.url');
    expect(vars).toContain('trigger.key');
  });

  describe('launch metadata validation', () => {
    it('should parse valid manual launch metadata', () => {
      const yaml = `
workflow_id: wf_launch
name: Launchable Workflow
trigger:
  type: manual
  launch:
    context: scope
    allow_raw_json: true
    inputs:
      - key: objective
        label: Objective
        type: string
        required: true
      - key: risk_level
        type: string
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;

      const def = service.parseWorkflow(yaml);
      expect(def.trigger?.launch).toEqual({
        context: 'scope',
        allow_raw_json: true,
        inputs: [
          {
            key: 'objective',
            label: 'Objective',
            type: 'string',
            required: true,
          },
          {
            key: 'risk_level',
            type: 'string',
          },
        ],
      });
    });

    it('should throw for invalid launch context', () => {
      const yaml = `
workflow_id: wf_bad_context
name: Invalid Launch Context
trigger:
  type: manual
  launch:
    context: invalid
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;

      expect(() => service.parseWorkflow(yaml)).toThrow(
        'trigger.launch.context must be one of: none, scope, context, resource',
      );
    });

    it('should throw for duplicate launch input keys', () => {
      const yaml = `
workflow_id: wf_dup_keys
name: Duplicate Launch Keys
trigger:
  type: manual
  launch:
    inputs:
      - key: objective
      - key: objective
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;

      expect(() => service.parseWorkflow(yaml)).toThrow(
        "trigger.launch.inputs contains duplicate key 'objective'",
      );
    });
  });

  describe('trigger type validation', () => {
    it('accepts valid trigger types (event, webhook, manual)', () => {
      for (const ttype of ['event', 'webhook', 'manual']) {
        const yaml = `
workflow_id: wf_trigger_t
name: Trigger Test
trigger:
  type: ${ttype}
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
        `;
        const def = service.parseWorkflow(yaml);
        expect(def.trigger?.type).toBe(ttype);
      }
    });

    it('rejects unknown trigger type', () => {
      const yaml = `
workflow_id: wf_bad
name: Bad Trigger
trigger:
  type: unknown
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(
        'trigger.type must be one of: event, webhook, manual, lifecycle',
      );
    });
  });

  describe('lifecycle trigger validation', () => {
    it('accepts a workflow with trigger.type lifecycle, phase merge, hook before, blocking true', () => {
      const yaml = `
workflow_id: wf_lifecycle
name: Lifecycle WF
trigger:
  type: lifecycle
  phase: merge
  hook: before
  blocking: true
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      const def = service.parseWorkflow(yaml);
      expect(def.trigger?.type).toBe('lifecycle');
      expect(def.trigger?.phase).toBe('merge');
      expect(def.trigger?.hook).toBe('before');
      expect(def.trigger?.blocking).toBe(true);
    });

    it('rejects lifecycle trigger with missing phase', () => {
      const yaml = `
workflow_id: wf_no_phase
name: Missing Phase
trigger:
  type: lifecycle
  hook: before
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(/phase/i);
    });

    it('rejects lifecycle trigger with missing hook', () => {
      const yaml = `
workflow_id: wf_no_hook
name: Missing Hook
trigger:
  type: lifecycle
  phase: merge
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(/hook/i);
    });

    it('rejects lifecycle trigger with non-boolean blocking', () => {
      const yaml = `
workflow_id: wf_bad_blocking
name: Bad Blocking
trigger:
  type: lifecycle
  phase: merge
  hook: before
  blocking: "yes"
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(/blocking/i);
    });

    it('rejects lifecycle trigger with empty phase string', () => {
      const yaml = `
workflow_id: wf_empty_phase
name: Empty Phase
trigger:
  type: lifecycle
  phase: ""
  hook: before
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(/phase/i);
    });

    it('rejects lifecycle trigger with empty hook string', () => {
      const yaml = `
workflow_id: wf_empty_hook
name: Empty Hook
trigger:
  type: lifecycle
  phase: merge
  hook: "   "
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(/hook/i);
    });
  });

  describe('skill_discovery_mode validation', () => {
    it('accepts a valid root-level skill_discovery_mode', () => {
      const def = service.parseWorkflow(
        [
          'workflow_id: wf',
          'name: Example',
          'skill_discovery_mode: search',
          'jobs:',
          '  - id: job1',
          '    type: execution',
          '    tier: heavy',
          '    steps:',
          '      - id: s1',
          '        skill_discovery_mode: native',
        ].join('\n'),
      );
      expect(def.skill_discovery_mode).toBe('search');
      expect(def.jobs?.[0]?.steps?.[0]?.skill_discovery_mode).toBe('native');
    });

    it('rejects an invalid root-level skill_discovery_mode', () => {
      expect(() =>
        service.parseWorkflow(
          [
            'workflow_id: wf',
            'name: Example',
            'skill_discovery_mode: bogus',
          ].join('\n'),
        ),
      ).toThrow(/skill_discovery_mode/);
    });

    it('rejects an invalid step-level skill_discovery_mode', () => {
      expect(() =>
        service.parseWorkflow(
          [
            'workflow_id: wf',
            'name: Example',
            'jobs:',
            '  - id: job1',
            '    type: execution',
            '    tier: heavy',
            '    steps:',
            '      - id: s1',
            '        skill_discovery_mode: bogus',
          ].join('\n'),
        ),
      ).toThrow(/skill_discovery_mode/);
    });
  });

  describe('concurrency validation', () => {
    it('should parse valid concurrency block', () => {
      const yaml = `
workflow_id: wf_c
name: Concurrency WF
concurrency:
  max_runs: 1
  scope: "trigger.scope_id"
  on_conflict: skip
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      const def = service.parseWorkflow(yaml);
      expect(def.concurrency).toEqual({
        max_runs: 1,
        scope: 'trigger.scope_id',
        on_conflict: 'skip',
      });
    });

    it('should parse concurrency with only max_runs', () => {
      const yaml = `
workflow_id: wf_c2
name: Concurrency WF 2
concurrency:
  max_runs: 3
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      const def = service.parseWorkflow(yaml);
      expect(def.concurrency).toEqual({ max_runs: 3 });
    });

    it('should throw for non-integer max_runs', () => {
      const yaml = `
workflow_id: wf_c3
name: Bad
concurrency:
  max_runs: 1.5
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(
        'concurrency.max_runs must be a positive integer',
      );
    });

    it('should throw for max_runs less than 1', () => {
      const yaml = `
workflow_id: wf_c4
name: Bad
concurrency:
  max_runs: 0
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(
        'concurrency.max_runs must be a positive integer',
      );
    });

    it('should throw for invalid on_conflict value', () => {
      const yaml = `
workflow_id: wf_c5
name: Bad
concurrency:
  max_runs: 1
  on_conflict: invalid
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(
        'concurrency.on_conflict must be one of: skip, queue, cancel_running',
      );
    });

    it('should throw for non-string scope', () => {
      const yaml = `
workflow_id: wf_c6
name: Bad
concurrency:
  max_runs: 1
  scope: 42
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
      `;
      expect(() => service.parseWorkflow(yaml)).toThrow(
        'concurrency.scope must be a string',
      );
    });

    it('should accept all valid on_conflict policies', () => {
      for (const policy of ['skip', 'queue', 'cancel_running']) {
        const yaml = `
workflow_id: wf_p_${policy}
name: Policy Test
concurrency:
  max_runs: 1
  on_conflict: ${policy}
jobs:
  - id: job_1
    type: execution
    tier: light
    steps:
      - id: step_1
        prompt: hello
        `;
        const def = service.parseWorkflow(yaml);
        expect(def.concurrency?.on_conflict).toBe(policy);
      }
    });
  });
});
