import { vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { StateManagerService } from './state-manager.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';

describe('StateManagerService', () => {
  let service: StateManagerService;
  let mockRunRepo: Mocked<Partial<IWorkflowRunRepository>>;

  beforeEach(async () => {
    mockRunRepo = {
      findById: vi.fn().mockResolvedValue({
        id: '123',
        state_variables: { user: { name: 'John' } },
      }),

      update: vi.fn().mockResolvedValue(null as any),
      setStateVariableAtomic: vi.fn().mockResolvedValue(undefined),
      deleteStateVariableAtomic: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateManagerService,
        {
          provide: WORKFLOW_RUN_REPOSITORY_PORT,
          useValue: mockRunRepo,
        },
      ],
    }).compile();

    service = module.get<StateManagerService>(StateManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getVariable', () => {
    it('should retrieve nested value', async () => {
      const val = await service.getVariable('123', 'user.name');
      expect(val).toBe('John');
    });

    it('should return undefined for missing path', async () => {
      const val = await service.getVariable('123', 'user.age');
      expect(val).toBeUndefined();
    });
  });

  describe('setVariable', () => {
    it('should set nested value atomically', async () => {
      await service.setVariable('123', 'user.age', 30);
      expect(mockRunRepo.setStateVariableAtomic).toHaveBeenCalledWith(
        '123',
        'user.age',
        30,
      );
      expect(mockRunRepo.findById).toHaveBeenCalledWith('123');
    });
  });

  describe('deleteVariable', () => {
    it('should delete a nested key atomically', async () => {
      await service.deleteVariable('123', '_internal.auto_retry.job-1');
      expect(mockRunRepo.deleteStateVariableAtomic).toHaveBeenCalledWith(
        '123',
        '_internal.auto_retry.job-1',
      );
    });
  });

  describe('substituteTemplate', () => {
    it('should substitute string variables', () => {
      const result = service.substituteTemplate('Hello {{ user.name }}!', {
        user: { name: 'Alice' },
      });
      expect(result).toBe('Hello Alice!');
    });

    it('should serialize object variables via json helper', () => {
      const result = service.substituteTemplate('Data: {{json data}}', {
        data: { id: 1 },
      });
      expect(result).toBe('Data: {"id":1}');
    });

    it('should clear missing variables', () => {
      const result = service.substituteTemplate('Value: {{ missing }}', {});
      expect(result).toBe('Value: ');
    });

    it('should resolve steps shorthand within current job context', () => {
      const result = service.substituteTemplate(
        'Step output: {{ steps.check.output.ok }}',
        {
          _internal: { current_job_id: 'job_1' },
          jobs: {
            job_1: {
              steps: {
                check: {
                  output: { ok: true },
                },
              },
            },
          },
        },
      );

      expect(result).toBe('Step output: true');
    });

    it('should render #if blocks for truthy values', () => {
      const result = service.substituteTemplate(
        '{{#if user}}Hello {{user.name}}{{/if}}',
        { user: { name: 'Alice' } },
      );
      expect(result).toBe('Hello Alice');
    });

    it('should omit #if blocks for falsy values', () => {
      const result = service.substituteTemplate(
        'Before{{#if missing}} HIDDEN{{/if}} After',
        {},
      );
      expect(result).toBe('Before After');
    });

    it('should render #each blocks over arrays', () => {
      const result = service.substituteTemplate(
        '{{#each items}}- {{this.name}}\n{{/each}}',
        { items: [{ name: 'A' }, { name: 'B' }] },
      );
      expect(result).toBe('- A\n- B\n');
    });

    it('should omit #each blocks for empty arrays', () => {
      const result = service.substituteTemplate(
        '{{#each items}}item{{/each}}',
        { items: [] },
      );
      expect(result).toBe('');
    });

    it('should render nested #if inside #each', () => {
      const template =
        '{{#each children}}{{#if this.priority}}[{{this.priority}}] {{/if}}{{this.title}}\n{{/each}}';
      const result = service.substituteTemplate(template, {
        children: [
          { title: 'Task A', priority: 'p1' },
          { title: 'Task B', priority: '' },
        ],
      });
      expect(result).toBe('[p1] Task A\nTask B\n');
    });

    it('should not HTML-escape content', () => {
      const result = service.substituteTemplate('{{value}}', {
        value: '<script>alert("xss")</script>',
      });
      expect(result).toBe('<script>alert("xss")</script>');
    });

    it('should throw when template rendering fails', () => {
      expect(() =>
        service.substituteTemplate('Value: {{#if user}}', {
          user: { name: 'Alice' },
        }),
      ).toThrow('Failed to render template "Value: {{#if user}}"');
    });

    it('supports multi-operand or helper fallback chains', () => {
      const result = service.substituteTemplate(
        '{{or item.subtask_id item.id item.title}}',
        {
          item: {
            title: 'Implement persistence adapter',
          },
        },
      );

      expect(result).toBe('Implement persistence adapter');
    });

    it('supports multi-operand and helper expressions', () => {
      const result = service.substituteTemplate(
        '{{#if (and one two three)}}true{{else}}false{{/if}}',
        {
          one: true,
          two: true,
          three: true,
        },
      );

      expect(result).toBe('true');
    });

    it('renders job-output equality conditions as literal true or false', () => {
      const condition =
        "{{#if (eq jobs.review_resource.output.decision 'reject')}}true{{else}}false{{/if}}";

      expect(
        service.substituteTemplate(condition, {
          jobs: { review_resource: { output: { decision: 'reject' } } },
        }),
      ).toBe('true');
      expect(
        service.substituteTemplate(condition, {
          jobs: { review_resource: { output: { decision: 'accept' } } },
        }),
      ).toBe('false');
    });

    it('supports numeric comparison helpers in templates', () => {
      const out = service.substituteTemplate(
        '{{#if (gte a 10)}}true{{else}}false{{/if}}',
        { a: 12 },
      );
      expect(out).toBe('true');
    });

    it('coerces stringified booleans via the bool helper so "false" is not truthy', () => {
      const positive =
        '{{#if (bool jobs.check.output.flag)}}true{{else}}false{{/if}}';

      expect(
        service.substituteTemplate(positive, {
          jobs: { check: { output: { flag: 'false' } } },
        }),
      ).toBe('false');
      expect(
        service.substituteTemplate(positive, {
          jobs: { check: { output: { flag: 'true' } } },
        }),
      ).toBe('true');
      expect(
        service.substituteTemplate(positive, {
          jobs: { check: { output: { flag: false } } },
        }),
      ).toBe('false');
    });

    it('negates coerced booleans correctly when combined with the not helper', () => {
      const negated =
        '{{#if (not (bool jobs.check.output.flag))}}true{{else}}false{{/if}}';

      expect(
        service.substituteTemplate(negated, {
          jobs: { check: { output: { flag: 'false' } } },
        }),
      ).toBe('true');
      expect(
        service.substituteTemplate(negated, {
          jobs: { check: { output: { flag: 'true' } } },
        }),
      ).toBe('false');
    });
  });
});
