import { BadRequestException } from '@nestjs/common';
import type { ScopeNodeType } from './scope.constants';

/**
 * Allowed child node types for each parent type (SDD §2.3).
 *
 * platform → org
 * org      → org | region | team | project
 * region   → team | project
 * team     → team | project
 * project  → (leaf, no children)
 */
export const PARENT_CHILD_TYPE_MATRIX: Readonly<
  Record<ScopeNodeType, readonly ScopeNodeType[]>
> = {
  platform: ['org'],
  org: ['org', 'region', 'team', 'project'],
  region: ['team', 'project'],
  team: ['team', 'project'],
  project: [],
};

/**
 * Throws {@link BadRequestException} unless `childType` may nest directly
 * under `parentType` per the SDD §2.3 typing matrix.
 */
export function assertValidParentChildType(
  parentType: ScopeNodeType,
  childType: ScopeNodeType,
): void {
  const allowedChildren = PARENT_CHILD_TYPE_MATRIX[parentType];
  if (allowedChildren.length === 0) {
    throw new BadRequestException(
      `A '${parentType}' scope is a leaf and cannot contain a '${childType}' child.`,
    );
  }
  if (!allowedChildren.includes(childType)) {
    throw new BadRequestException(
      `A '${childType}' scope cannot nest under a '${parentType}' scope. ` +
        `Allowed children of '${parentType}': ${allowedChildren.join(', ')}.`,
    );
  }
}
