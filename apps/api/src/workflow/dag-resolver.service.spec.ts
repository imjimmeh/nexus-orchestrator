import { Test, TestingModule } from '@nestjs/testing';
import { DAGResolverService } from './dag-resolver.service';

describe('DAGResolverService', () => {
  let service: DAGResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DAGResolverService],
    }).compile();

    service = module.get<DAGResolverService>(DAGResolverService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should resolve a valid DAG', () => {
    const jobs = [
      {
        id: '1',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 's1', prompt: '' }],
      },
      {
        id: '2',
        type: 'execution' as const,
        tier: 'light',
        depends_on: ['1'],
        steps: [{ id: 's1', prompt: '' }],
      },
      {
        id: '3',
        type: 'execution' as const,
        tier: 'light',
        depends_on: ['2'],
        steps: [{ id: 's1', prompt: '' }],
      },
    ];
    const graph = service.buildDependencyGraph(jobs);
    const sorted = service.topologicalSort(graph);
    expect(sorted).toEqual(['1', '2', '3']);
  });

  it('should detect cycles', () => {
    const jobs = [
      {
        id: '1',
        type: 'execution' as const,
        tier: 'light',
        depends_on: ['2'],
        steps: [{ id: 's1', prompt: '' }],
      },
      {
        id: '2',
        type: 'execution' as const,
        tier: 'light',
        depends_on: ['1'],
        steps: [{ id: 's1', prompt: '' }],
      },
    ];
    expect(() => service.buildDependencyGraph(jobs)).toThrow(
      /Circular dependency/,
    );
  });

  it('should not treat transition targets as DAG dependencies', () => {
    const jobs = [
      {
        id: 'decide',
        type: 'execution' as const,
        tier: 'light',
        transitions: [
          { condition: 'jobs.decide.output.ok == true', next: 'chosen' },
        ],
        steps: [{ id: 's1', prompt: '' }],
      },
      {
        id: 'chosen',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 's1', prompt: '' }],
      },
    ];
    const graph = service.buildDependencyGraph(jobs);
    expect(graph.get('chosen')).toEqual([]);
    expect(graph.get('decide')).toEqual([]);
  });

  it('should keep explicit depends_on unchanged when transitions are present', () => {
    const jobs = [
      {
        id: 'a',
        type: 'execution' as const,
        tier: 'light',
        transitions: [{ condition: 'true', next: 'c' }],
        steps: [{ id: 's1', prompt: '' }],
      },
      {
        id: 'b',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 's1', prompt: '' }],
      },
      {
        id: 'c',
        type: 'execution' as const,
        tier: 'light',
        depends_on: ['b'],
        steps: [{ id: 's1', prompt: '' }],
      },
    ];
    const graph = service.buildDependencyGraph(jobs);
    expect(graph.get('c')).toEqual(['b']);
  });

  it('should allow self-referential transition loops', () => {
    const jobs = [
      {
        id: 'loop_step',
        type: 'execution' as const,
        tier: 'light',
        transitions: [
          { condition: 'jobs.loop_step.output.ok == true', next: 'loop_step' },
        ],
        steps: [{ id: 's1', prompt: '' }],
      },
    ];

    expect(() => service.buildDependencyGraph(jobs)).not.toThrow();
  });

  it('should reject transitions to unknown jobs', () => {
    const jobs = [
      {
        id: 'start',
        type: 'execution' as const,
        tier: 'light',
        transitions: [{ condition: 'true', next: 'missing' }],
        steps: [{ id: 's1', prompt: '' }],
      },
    ];

    expect(() => service.buildDependencyGraph(jobs)).toThrow(
      /transitions to unknown job/,
    );
  });
});
