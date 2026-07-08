import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadYamlTreeFromDir } from './gitops-yaml-loader';

describe('loadYamlTreeFromDir', () => {
  it('ignores malformed YAML outside the desired-state layout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitops-yaml-loader-'));
    await mkdir(path.join(root, 'unrelated'), { recursive: true });
    await mkdir(path.join(root, 'scopes'), { recursive: true });

    await writeFile(path.join(root, 'unrelated', 'broken.yaml'), ':- not yaml');
    await writeFile(
      path.join(root, 'scopes', 'scope.yaml'),
      [
        'apiVersion: nexus.gitops/v1',
        'kind: ScopeNode',
        'type: platform',
        'name: Platform',
        'slug: platform',
        '',
      ].join('\n'),
    );

    const files = await loadYamlTreeFromDir(root);

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('scopes/scope.yaml');
  });

  it('ignores GitOps sidecars and still parses malformed docs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitops-yaml-loader-'));
    await mkdir(path.join(root, 'scopes', 'acme', 'agents'), {
      recursive: true,
    });

    await writeFile(
      path.join(root, 'scopes', 'acme', 'agents', 'assistant.PROMPT.md'),
      '# prompt sidecar',
    );
    await writeFile(
      path.join(root, 'scopes', 'acme', 'agents', 'assistant.body.yaml'),
      'not: [sidecar',
    );
    await writeFile(
      path.join(root, 'scopes', 'acme', 'agents', 'assistant.yaml'),
      [
        'apiVersion: nexus.gitops/v1',
        'kind: AgentOverride',
        'name: assistant',
        'scope: /acme',
        'source: admin',
        'locked: false',
        'strategy: merge',
        'definition:',
        '  tool_policy: null',
        'overrides: null',
        '',
      ].join('\n'),
    );

    const files = await loadYamlTreeFromDir(root);

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('scopes/acme/agents/assistant.yaml');
  });

  it('fails on malformed GitOps docs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitops-yaml-loader-'));
    await mkdir(path.join(root, 'scopes', 'acme', 'agents'), {
      recursive: true,
    });

    await writeFile(
      path.join(root, 'scopes', 'acme', 'agents', 'assistant.yaml'),
      'not: [a valid doc',
    );

    await expect(loadYamlTreeFromDir(root)).rejects.toThrow();
  });

  it('preserves layout prefixes when rooted at a subtree', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitops-yaml-loader-'));
    await mkdir(path.join(root, 'scopes', 'acme'), { recursive: true });
    await writeFile(
      path.join(root, 'scopes', 'acme', 'scope.yaml'),
      [
        'apiVersion: nexus.gitops/v1',
        'kind: ScopeNode',
        'type: org',
        'name: Acme',
        'slug: acme',
        '',
      ].join('\n'),
    );

    const files = await (loadYamlTreeFromDir as any)(
      path.join(root, 'scopes', 'acme'),
      {
        pathPrefix: 'scopes/acme',
      },
    );

    expect(files).toEqual([
      expect.objectContaining({ path: 'scopes/acme/scope.yaml' }),
    ]);
  });

  it('keeps repo-root layout paths without prefixing arbitrary roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitops-yaml-loader-'));
    await mkdir(path.join(root, 'platform-config', 'scopes', 'acme'), {
      recursive: true,
    });
    await writeFile(
      path.join(root, 'platform-config', 'scopes', 'acme', 'scope.yaml'),
      [
        'apiVersion: nexus.gitops/v1',
        'kind: ScopeNode',
        'type: org',
        'name: Acme',
        'slug: acme',
        '',
      ].join('\n'),
    );

    const files = await loadYamlTreeFromDir(path.join(root, 'platform-config'));

    expect(files).toEqual([
      expect.objectContaining({ path: 'scopes/acme/scope.yaml' }),
    ]);
  });

  it.each(['./scopes/acme', 'scopes/../scopes/acme'])(
    'canonicalizes layout prefixes before emitting paths: %s',
    async (pathPrefix) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'gitops-yaml-loader-'));
      await mkdir(path.join(root, 'scopes', 'acme'), { recursive: true });
      await writeFile(
        path.join(root, 'scopes', 'acme', 'scope.yaml'),
        [
          'apiVersion: nexus.gitops/v1',
          'kind: ScopeNode',
          'type: org',
          'name: Acme',
          'slug: acme',
          '',
        ].join('\n'),
      );

      const files = await loadYamlTreeFromDir(root, { pathPrefix });

      expect(files).toEqual([
        expect.objectContaining({ path: 'scopes/acme/scope.yaml' }),
      ]);
    },
  );
});
