import { SystemPromptAssemblyService } from './system-prompt-assembly.service';
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
} from './system-prompt-contributor.types';

const ctx: PromptAssemblyContext = {
  runType: 'workflow',
  baseLayers: [{ id: 'resolved', content: 'You are an agent.' }],
};

function stubContributor(
  name: string,
  block: string,
  priority?: number,
): ISystemPromptContributor {
  return {
    name,
    priority,
    contribute: () =>
      Promise.resolve({
        title: name,
        content: block,
        priority: priority ?? 100,
      }),
  };
}

describe('SystemPromptAssemblyService registry', () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it('registers contributors and reports names in insertion order', () => {
    service.register(stubContributor('a', 'A'));
    service.register(stubContributor('b', 'B'));
    expect(service.getRegisteredNames()).toEqual(['a', 'b']);
    expect(service.getRegisteredCount()).toBe(2);
    expect(service.isRegistryEmpty()).toBe(false);
  });

  it('overwrites a duplicate name without growing the registry', () => {
    service.register(stubContributor('a', 'A'));
    service.register(stubContributor('a', 'A2'));
    expect(service.getRegisteredCount()).toBe(1);
  });

  it('reports empty registry and clears for testing', () => {
    expect(service.isRegistryEmpty()).toBe(true);
    service.register(stubContributor('a', 'A'));
    service.clearForTesting();
    expect(service.isRegistryEmpty()).toBe(true);
  });
});

describe('SystemPromptAssemblyService.gatherBlocks', () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it('orders blocks by priority desc, tie-broken by registration order', async () => {
    service.register(stubContributor('low', 'L', 50));
    service.register(stubContributor('high', 'H', 200));
    service.register(stubContributor('mid-a', 'A', 100));
    service.register(stubContributor('mid-b', 'B', 100));
    const { blocks, applied } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual([
      'high',
      'mid-a',
      'mid-b',
      'low',
    ]);
    expect(applied).toEqual(['high', 'mid-a', 'mid-b', 'low']);
  });

  it('skips a contributor that returns null', async () => {
    service.register(stubContributor('keep', 'K'));
    service.register({ name: 'skip', contribute: () => Promise.resolve(null) });
    const { blocks, applied } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual(['keep']);
    expect(applied).toEqual(['keep']);
  });

  it('is fail-open when a contributor throws', async () => {
    service.register(stubContributor('keep', 'K'));
    service.register({
      name: 'boom',
      contribute: () => Promise.reject(new Error('kaboom')),
    });
    const { blocks, skipped } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual(['keep']);
    expect(skipped).toEqual([
      { name: 'boom', stage: 'contribute', reason: 'kaboom' },
    ]);
  });

  it('is fail-open when a contributor exceeds its timeout', async () => {
    service.register(stubContributor('keep', 'K'));
    service.register({
      name: 'slow',
      timeoutMs: 10,
      contribute: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({ title: 'slow', content: 'S', priority: 100 });
          }, 50),
        ),
    });
    const { blocks, skipped } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual(['keep']);
    expect(skipped[0]?.name).toBe('slow');
    expect(skipped[0]?.reason).toMatch(/timed out/i);
  });
});

describe('SystemPromptAssemblyService.applyTransforms', () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it('chains transformers in priority order', async () => {
    service.register({
      name: 't-low',
      priority: 10,
      contribute: () => Promise.resolve(null),
      transform: (s) => Promise.resolve(`${s} <low>`),
    });
    service.register({
      name: 't-high',
      priority: 90,
      contribute: () => Promise.resolve(null),
      transform: (s) => Promise.resolve(`${s} <high>`),
    });
    const { prompt } = await service.applyTransforms('BASE', ctx);
    expect(prompt).toBe('BASE <high> <low>');
  });

  it('passes through when a transform returns null', async () => {
    service.register({
      name: 'noop',
      contribute: () => Promise.resolve(null),
      transform: () => Promise.resolve(null),
    });
    const { prompt } = await service.applyTransforms('BASE', ctx);
    expect(prompt).toBe('BASE');
  });

  it('supports full override and is fail-open on a throwing transform', async () => {
    service.register({
      name: 'boom',
      priority: 90,
      contribute: () => Promise.resolve(null),
      transform: () => Promise.reject(new Error('bad transform')),
    });
    service.register({
      name: 'replace',
      priority: 10,
      contribute: () => Promise.resolve(null),
      transform: () => Promise.resolve('REPLACED'),
    });
    const { prompt, skipped } = await service.applyTransforms('BASE', ctx);
    expect(prompt).toBe('REPLACED');
    expect(skipped).toEqual([
      { name: 'boom', stage: 'transform', reason: 'bad transform' },
    ]);
  });
});

describe('SystemPromptAssemblyService.assemble', () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it('merges base layers and contributed blocks, then transforms', async () => {
    service.register(stubContributor('extra', 'Extra context.', 100));
    service.register({
      name: 'wrap',
      priority: 10,
      contribute: () => Promise.resolve(null),
      transform: (s) => Promise.resolve(`${s}\n\n-- END --`),
    });
    const result = await service.assemble({
      runType: 'workflow',
      harnessId: 'pi',
      baseLayers: [
        { id: 'runtime', content: 'Runtime context.' },
        { id: 'resolved', content: 'You are an agent.' },
        { id: 'empty', content: '   ' },
      ],
    });
    expect(result.prompt).toBe(
      'Runtime context.\n\nYou are an agent.\n\n## extra\n\nExtra context.\n\n-- END --',
    );
    expect(result.applied).toEqual(['extra']);
    expect(result.skipped).toEqual([]);
  });

  it('returns base layers only when the registry is empty (no-op)', async () => {
    const result = await service.assemble({
      runType: 'workflow',
      baseLayers: [{ id: 'resolved', content: 'You are an agent.' }],
    });
    expect(result.prompt).toBe('You are an agent.');
    expect(result.blocks).toEqual([]);
  });
});

describe('empty-registry semantics', () => {
  it('workflow assemble is a no-op with zero contributors', async () => {
    const service = new SystemPromptAssemblyService();
    const result = await service.assemble({
      runType: 'workflow',
      baseLayers: [{ id: 'resolved', content: 'Base only.' }],
    });
    expect(result.prompt).toBe('Base only.');
    expect(service.isRegistryEmpty()).toBe(true);
  });
});
