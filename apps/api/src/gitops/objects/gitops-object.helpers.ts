import { ScopeService } from '../../scope/scope.service';
import type { ScopeTreeNodeLike } from './gitops-object.helpers.types';

export async function buildScopePathById(
  scope: Pick<ScopeService, 'getTree'>,
): Promise<Map<string, string>> {
  const tree = (await scope.getTree()) as ScopeTreeNodeLike | null;
  const paths = new Map<string, string>();
  if (!tree) {
    return paths;
  }

  const visit = (node: ScopeTreeNodeLike, parentPath: string): void => {
    const path =
      parentPath === '/' ? `/${node.slug}` : `${parentPath}/${node.slug}`;
    const normalizedPath = node.slug === '' ? '/' : path;
    paths.set(node.id, normalizedPath);
    for (const child of node.children ?? []) {
      visit(child, normalizedPath);
    }
  };

  visit(tree, '/');
  return paths;
}

export async function resolveScopeNodeId(
  scope: Pick<ScopeService, 'getTree'>,
  scopePath: string | null | undefined,
): Promise<string | null> {
  if (!scopePath || scopePath === '/') {
    return scopePath === '/' ? ((await scope.getTree())?.id ?? null) : null;
  }

  if (!scopePath.startsWith('/')) {
    return scopePath;
  }

  const tree = (await scope.getTree()) as ScopeTreeNodeLike | null;
  if (!tree) {
    return null;
  }

  const segments = scopePath
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  let current: ScopeTreeNodeLike | null = tree;

  for (const segment of segments) {
    current =
      (current?.children ?? []).find((child) => child.slug === segment) ?? null;
    if (!current) {
      return null;
    }
  }

  return current.id;
}

export function resolveNameFromKey(key: string): string {
  const suffix = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
  return suffix.replace(/^\/+/, '');
}

export function diffFields(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(to)) {
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      diff[key] = { from: from[key], to: to[key] };
    }
  }
  return diff;
}

export function toDbArray(value: string[] | null): string | null {
  return value === null ? null : value.join(',');
}

export function fromDbArray(value: string | null): string[] | null {
  if (!value) {
    return null;
  }

  return value.split(',').filter(Boolean);
}

export function resolveManagedBindingId(
  fields: Record<string, unknown>,
): string | null {
  const value = fields['managedBindingId'];
  return typeof value === 'string' ? value : null;
}

export function requireGitOpsBindingId(bindingId: string | undefined): string {
  if (!bindingId) {
    throw new Error('GitOps apply requires a repository binding id');
  }

  return bindingId;
}
