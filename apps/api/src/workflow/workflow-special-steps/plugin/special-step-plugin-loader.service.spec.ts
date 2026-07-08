import { mkdtemp, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StepSpecialStepRegistryService } from '../step-special-step-registry.service';
import { SpecialStepPluginLoaderService } from './special-step-plugin-loader.service';

describe('SpecialStepPluginLoaderService', () => {
  let tempDirs: string[];
  let registry: Pick<StepSpecialStepRegistryService, 'registerPluginHandler'>;
  let service: SpecialStepPluginLoaderService;

  beforeEach(() => {
    tempDirs = [];
    registry = {
      registerPluginHandler: vi.fn(),
    };
    service = new SpecialStepPluginLoaderService(
      registry as StepSpecialStepRegistryService,
    );
  });

  afterEach(async () => {
    for (const tempDir of tempDirs) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('skips loading when plugin directory is not configured', async () => {
    await service.loadPlugins('');

    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('skips missing plugin directory without registration', async () => {
    const pluginDir = join(await createTempDir(), 'missing');

    await service.loadPlugins(pluginDir);

    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('loads a valid plugin and registers its handler', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [
          {
            type: 'greet_user',
            async execute(context) {
              return {
                result: { status: 'completed', source: 'plugin', mode: 'greet_user' },
                output: { greeting: context.resolvedStepInputs.name }
              };
            }
          }
        ]
      }`,
    });

    await service.loadPlugins(pluginDir);

    expect(registry.registerPluginHandler).toHaveBeenCalledTimes(1);
    const [handler] = vi.mocked(registry.registerPluginHandler).mock.calls[0];
    expect(handler.type).toBe('greet_user');
    expect(handler.descriptor).toEqual({
      type: 'greet_user',
      owningDomain: 'plugin',
      pluginId: 'greeter',
      displayName: 'Greet user',
      description: 'Greets a user',
      inputContract: 'name: string',
    });
    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'step-1',
        step: { id: 'step-1', type: 'greet_user' } as never,
        resolvedStepInputs: { name: 'Ada' },
      }),
    ).resolves.toEqual({
      result: { status: 'completed', source: 'plugin', mode: 'greet_user' },
      output: { greeting: 'Ada' },
    });
  });

  it('rejects plugin whose export manifest id does not match file manifest', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'other-plugin' },
        handlers: [{ type: 'greet_user', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'greet_user' }, output: {} }; } }]
      }`,
    });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      "Plugin greeter export manifest id 'other-plugin' does not match nexus.plugin.json id 'greeter'",
    );
  });

  it('rejects plugin manifest whose handler is not exported', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: []
      }`,
    });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      "Plugin greeter manifest declares special step 'greet_user' but no matching handler was exported",
    );
  });

  it('rejects plugin package without nexus.plugin.json', async () => {
    const pluginDir = await createTempDir();
    await mkdir(join(pluginDir, 'missing-manifest'), { recursive: true });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      'Special step plugin package missing nexus.plugin.json',
    );
  });

  it('rejects plugin entrypoint that resolves outside package directory', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({
        id: 'greeter',
        type: 'greet_user',
        entrypoint: '../outside.mjs',
      }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [{ type: 'greet_user', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'greet_user' }, output: {} }; } }]
      }`,
    });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      "Plugin greeter entrypoint '../outside.mjs' resolves outside plugin package directory",
    );
    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('rejects absolute plugin entrypoint', async () => {
    const pluginDir = await createTempDir();
    const absoluteEntrypoint = join(pluginDir, 'absolute-entrypoint.mjs');
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({
        id: 'greeter',
        type: 'greet_user',
        entrypoint: absoluteEntrypoint,
      }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [{ type: 'greet_user', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'greet_user' }, output: {} }; } }]
      }`,
    });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      `Plugin greeter entrypoint '${absoluteEntrypoint}' resolves outside plugin package directory`,
    );
    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('rejects symlinked plugin entrypoint that resolves outside package directory', async () => {
    const pluginDir = await createTempDir();
    const outsideDir = await createTempDir();
    const outsideEntrypoint = join(outsideDir, 'outside-entrypoint.mjs');
    const packageDir = join(pluginDir, 'greeter');
    const symlinkedEntrypoint = join(packageDir, 'linked-entrypoint.mjs');

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      outsideEntrypoint,
      `export default {
        manifest: { id: 'greeter' },
        handlers: [{ type: 'greet_user', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'greet_user' }, output: {} }; } }]
      };`,
      'utf8',
    );

    try {
      await symlink(outsideEntrypoint, symlinkedEntrypoint, 'file');
    } catch {
      console.warn(
        'Skipping symlink containment regression: symlink creation is not permitted on this platform.',
      );
      return;
    }

    await writeFile(
      join(packageDir, 'nexus.plugin.json'),
      JSON.stringify(
        createManifest({
          id: 'greeter',
          type: 'greet_user',
          entrypoint: './linked-entrypoint.mjs',
        }),
      ),
      'utf8',
    );

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      "Plugin greeter entrypoint './linked-entrypoint.mjs' resolves outside plugin package directory",
    );
    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('rejects malformed exported handler missing execute', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [{ type: 'greet_user' }]
      }`,
    });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      "Plugin greeter exported handler for special step 'greet_user' must have a function execute",
    );
    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('rejects malformed extra exported handler before matching manifest steps', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [
          { type: '', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'unused' }, output: {} }; } },
          { type: 'greet_user', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'greet_user' }, output: {} }; } }
        ]
      }`,
    });

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      'Plugin greeter exported handler at index 0 must have a non-empty string type',
    );
    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('rejects plugin handler result missing plugin source', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [{ type: 'greet_user', async execute() { return { result: { status: 'completed', mode: 'greet_user' }, output: {} }; } }]
      }`,
    });

    await service.loadPlugins(pluginDir);
    const [handler] = vi.mocked(registry.registerPluginHandler).mock.calls[0];

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'step-1',
        step: { id: 'step-1', type: 'greet_user' } as never,
        resolvedStepInputs: {},
      }),
    ).rejects.toThrow(
      "Plugin greeter handler 'greet_user' returned invalid result: result.source must be 'plugin'",
    );
  });

  it('rejects plugin handler result with non-record output', async () => {
    const pluginDir = await createTempDir();
    await writePluginPackage(pluginDir, 'greeter', {
      manifest: createManifest({ id: 'greeter', type: 'greet_user' }),
      exportedPlugin: `{
        manifest: { id: 'greeter' },
        handlers: [{ type: 'greet_user', async execute() { return { result: { status: 'completed', source: 'plugin', mode: 'greet_user' }, output: [] }; } }]
      }`,
    });

    await service.loadPlugins(pluginDir);
    const [handler] = vi.mocked(registry.registerPluginHandler).mock.calls[0];

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'step-1',
        step: { id: 'step-1', type: 'greet_user' } as never,
        resolvedStepInputs: {},
      }),
    ).rejects.toThrow(
      "Plugin greeter handler 'greet_user' returned invalid result: output must be a record object",
    );
  });

  it('includes manifest path in invalid JSON manifest errors', async () => {
    const pluginDir = await createTempDir();
    const packageDir = join(pluginDir, 'broken-json');
    const manifestPath = join(packageDir, 'nexus.plugin.json');
    await mkdir(packageDir, { recursive: true });
    await writeFile(manifestPath, '{ invalid json', 'utf8');

    await expect(service.loadPlugins(pluginDir)).rejects.toThrow(
      `Invalid special step plugin manifest at ${manifestPath}:`,
    );
    expect(registry.registerPluginHandler).not.toHaveBeenCalled();
  });

  async function createTempDir(): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), 'nexus-plugin-loader-'));
    tempDirs.push(tempDir);
    return tempDir;
  }
});

function createManifest({
  id,
  type,
  entrypoint = './index.mjs',
}: {
  id: string;
  type: string;
  entrypoint?: string;
}) {
  return {
    id,
    name: id,
    version: '1.0.0',
    entrypoint,
    specialSteps: [
      {
        type,
        displayName: 'Greet user',
        description: 'Greets a user',
        inputContract: 'name: string',
      },
    ],
  };
}

async function writePluginPackage(
  pluginRoot: string,
  packageName: string,
  {
    manifest,
    exportedPlugin,
  }: { manifest: Record<string, unknown>; exportedPlugin: string },
): Promise<void> {
  const packageDir = join(pluginRoot, packageName);
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'nexus.plugin.json'),
    JSON.stringify(manifest),
    'utf8',
  );
  await writeFile(
    join(packageDir, 'index.mjs'),
    `export default ${exportedPlugin};`,
    'utf8',
  );
}
