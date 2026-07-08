import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertValidParentChildType } from './scope-typing';
import { SCOPE_NODE_TYPES } from './scope.constants';
import type { ScopeNodeType } from './scope.constants';

const ALLOWED: ReadonlyArray<[ScopeNodeType, ScopeNodeType]> = [
  ['platform', 'org'],
  ['org', 'org'],
  ['org', 'region'],
  ['org', 'team'],
  ['org', 'project'],
  ['region', 'team'],
  ['region', 'project'],
  ['team', 'team'],
  ['team', 'project'],
];

function isAllowed(parent: ScopeNodeType, child: ScopeNodeType): boolean {
  return ALLOWED.some(([p, c]) => p === parent && c === child);
}

describe('assertValidParentChildType', () => {
  it('accepts every allowed parent→child pair', () => {
    for (const [parent, child] of ALLOWED) {
      expect(() => {
        assertValidParentChildType(parent, child);
      }).not.toThrow();
    }
  });

  it('rejects every non-allowed parent→child pair with BadRequestException', () => {
    for (const parent of SCOPE_NODE_TYPES) {
      for (const child of SCOPE_NODE_TYPES) {
        if (isAllowed(parent, child)) continue;
        expect(() => {
          assertValidParentChildType(parent, child);
        }).toThrow(BadRequestException);
      }
    }
  });

  it('rejects any child under a project (leaf)', () => {
    for (const child of SCOPE_NODE_TYPES) {
      expect(() => {
        assertValidParentChildType('project', child);
      }).toThrow(/project.*cannot contain|leaf/i);
    }
  });

  it('names both types in the error message', () => {
    expect(() => {
      assertValidParentChildType('team', 'org');
    }).toThrow(/team/);
    expect(() => {
      assertValidParentChildType('team', 'org');
    }).toThrow(/org/);
  });
});
