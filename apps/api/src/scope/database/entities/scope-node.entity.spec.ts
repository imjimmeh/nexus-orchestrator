import { describe, it, expect } from 'vitest';
import { ScopeNode } from './scope-node.entity';
import { SCOPE_NODE_TYPES } from '../../scope.constants';

describe('ScopeNode entity', () => {
  it('constructs with the expected fields', () => {
    const node = new ScopeNode();
    node.id = 'n1';
    node.parentId = null;
    node.type = 'org';
    node.name = 'Acme';
    node.slug = 'acme';
    expect(node.type).toBe('org');
    expect(node.parentId).toBeNull();
  });

  it('exposes the canonical node-type list', () => {
    expect(SCOPE_NODE_TYPES).toEqual([
      'platform',
      'org',
      'region',
      'team',
      'project',
    ]);
  });
});
