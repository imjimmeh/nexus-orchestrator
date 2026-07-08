import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { ScopeNode } from './database/entities/scope-node.entity';
import { SCOPE_NODE_TYPES, GLOBAL_SCOPE_NODE_ID } from './scope.constants';
import type { ScopeNodeType } from './scope.constants';
import {
  assertValidParentChildType,
  PARENT_CHILD_TYPE_MATRIX,
} from './scope-typing';
import type {
  CreateScopeNodeInput,
  ScopeTreeNode,
  UpdateScopeNodeInput,
} from './scope.service.types';
import { AuthorizationAuditService } from '../auth/authorization/authorization-audit.service';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';

interface UuidRow {
  id: string;
}

interface AncestorRow {
  ancestor_id: string;
}

interface DescendantRow {
  descendant_id: string;
}

/** Represents one raw row returned by `SELECT 1` existence-check queries. */
interface ExistenceRow {
  '?column?': number;
}

export type {
  CreateScopeNodeInput,
  ScopeTreeNode,
  UpdateScopeNodeInput,
} from './scope.service.types';

/** Node types allowed to carry the `isTenantRoot` tenant-boundary flag. */
const TENANT_ROOT_ELIGIBLE_TYPES: ReadonlySet<ScopeNodeType> = new Set([
  'org',
  'platform',
]);

/** Throws if `isTenantRoot: true` is being applied to an ineligible node type. */
function assertValidTenantRootType(
  isTenantRoot: boolean | undefined,
  type: ScopeNodeType,
): void {
  if (isTenantRoot && !TENANT_ROOT_ELIGIBLE_TYPES.has(type)) {
    throw new BadRequestException(
      `isTenantRoot may only be set on 'org' or 'platform' scope nodes. Got: '${type}'.`,
    );
  }
}

@Injectable()
export class ScopeService {
  constructor(
    @InjectRepository(ScopeNode) private readonly nodes: Repository<ScopeNode>,
    private readonly dataSource: DataSource,
    @Optional() private readonly authzAudit?: AuthorizationAuditService,
    @Optional()
    private readonly scopeAccessService?: ScopeAccessService,
  ) {}

  async createNode(input: CreateScopeNodeInput): Promise<ScopeNode> {
    if (!SCOPE_NODE_TYPES.includes(input.type)) {
      throw new BadRequestException(`Unknown scope node type: ${input.type}`);
    }
    assertValidTenantRootType(input.isTenantRoot, input.type);
    const parentId = input.parentId ?? GLOBAL_SCOPE_NODE_ID;

    const node = await this.dataSource.transaction(async (m: EntityManager) => {
      const uuidRows = await m.query<UuidRow[]>(
        `SELECT gen_random_uuid() AS id`,
      );
      const id = input.id ?? uuidRows[0].id;

      const parentTypeRows = await m.query<Array<{ type: ScopeNodeType }>>(
        `SELECT type FROM scope_nodes WHERE id = $1`,
        [parentId],
      );
      if (parentTypeRows.length === 0) {
        throw new BadRequestException(
          `Parent scope node ${parentId} does not exist.`,
        );
      }
      assertValidParentChildType(parentTypeRows[0].type, input.type);

      await m.query(
        `INSERT INTO scope_nodes (id, parent_id, type, name, slug, metadata, is_tenant_root)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          parentId,
          input.type,
          input.name,
          input.slug,
          input.metadata ?? null,
          input.isTenantRoot ?? false,
        ],
      );
      // Copy all ancestor closure rows from parent (depth+1) + self-row at depth 0.
      await m.query(
        `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
         SELECT ancestor_id, $1, depth + 1 FROM scope_node_closure WHERE descendant_id = $2`,
        [id, parentId],
      );
      await m.query(
        `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
         VALUES ($1, $1, 0) ON CONFLICT DO NOTHING`,
        [id],
      );
      return Object.assign(new ScopeNode(), { ...input, id, parentId });
    });
    await this.authzAudit?.recordScopeCreated({
      actorId: input.actorId ?? 'system',
      scopeNodeId: node.id,
      parentId: node.parentId ?? null,
      type: input.type,
    });
    return node;
  }

  /** True iff scopeId resolves to a non-archived scope_nodes row. */
  async isLiveScope(scopeId: string): Promise<boolean> {
    const node = await this.nodes.findOne({
      where: { id: scopeId, archivedAt: IsNull() },
    });
    return node !== null;
  }

  /** Ids of all ancestors of nodeId, root-first, INCLUDING the node itself. */
  async getAncestorIds(nodeId: string): Promise<string[]> {
    const rows = await this.nodes.query<AncestorRow[]>(
      `SELECT ancestor_id FROM scope_node_closure WHERE descendant_id = $1 ORDER BY depth DESC`,
      [nodeId],
    );
    return rows.map((r) => r.ancestor_id);
  }

  /** Ids of all descendants of nodeId, INCLUDING itself. */
  async getDescendantIds(nodeId: string): Promise<string[]> {
    const rows = await this.nodes.query<DescendantRow[]>(
      `SELECT descendant_id FROM scope_node_closure WHERE ancestor_id = $1`,
      [nodeId],
    );
    return rows.map((r) => r.descendant_id);
  }

  /**
   * Full scope hierarchy as a single nested tree rooted at the global scope
   * node, filtered to the caller's accessible scopes. Returns null if the
   * global root has not been seeded yet or the user has no accessible scopes.
   *
   * If `ScopeAccessService` is not injected (e.g. in test/dev mode), the full
   * unfiltered tree is returned.
   */
  async getTree(userId?: string): Promise<ScopeTreeNode | null> {
    const nodes = await this.nodes.find({ where: { archivedAt: IsNull() } });
    const byId = new Map<string, ScopeTreeNode>();

    for (const node of nodes) {
      byId.set(node.id, {
        id: node.id,
        parentId: node.parentId,
        type: node.type,
        name: node.name,
        slug: node.slug,
        metadata: node.metadata,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        isTenantRoot: node.isTenantRoot,
        children: [],
      });
    }

    for (const node of byId.values()) {
      if (node.parentId === null) continue;
      byId.get(node.parentId)?.children.push(node);
    }

    for (const node of byId.values()) {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (!this.scopeAccessService || !userId) {
      return byId.get(GLOBAL_SCOPE_NODE_ID) ?? null;
    }

    const accessibleIds = new Set(
      await this.scopeAccessService.getAccessibleScopeIds(
        userId,
        'scopes:read',
      ),
    );

    if (accessibleIds.size === 0) return null;

    if (accessibleIds.has(GLOBAL_SCOPE_NODE_ID)) {
      return byId.get(GLOBAL_SCOPE_NODE_ID) ?? null;
    }

    const allowedIds = new Set<string>();
    const collectWithAncestors = (id: string): void => {
      if (allowedIds.has(id)) return;
      allowedIds.add(id);
      const node = byId.get(id);
      if (node?.parentId) collectWithAncestors(node.parentId);
    };

    for (const id of accessibleIds) {
      collectWithAncestors(id);
    }

    const prune = (node: ScopeTreeNode): ScopeTreeNode => ({
      ...node,
      children: node.children.filter((c) => allowedIds.has(c.id)).map(prune),
    });

    const root = byId.get(GLOBAL_SCOPE_NODE_ID);
    return root ? prune(root) : null;
  }

  /** Idempotently ensures a scope node exists. Useful for migrations and project registration. */
  async ensureNode(input: CreateScopeNodeInput): Promise<ScopeNode> {
    if (!SCOPE_NODE_TYPES.includes(input.type)) {
      throw new BadRequestException(`Unknown scope node type: ${input.type}`);
    }
    const parentId = input.parentId ?? GLOBAL_SCOPE_NODE_ID;
    const id = input.id;
    if (!id) {
      throw new BadRequestException('ensureNode requires an explicit id.');
    }

    return this.dataSource.transaction(async (m: EntityManager) => {
      // Atomic upsert: insert if absent, do nothing if present.
      await m.query(
        `INSERT INTO scope_nodes (id, parent_id, type, name, slug, metadata, is_tenant_root)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          parentId,
          input.type,
          input.name,
          input.slug,
          input.metadata ?? null,
          input.isTenantRoot ?? false,
        ],
      );
      // Insert closure rows only if the node was just created.
      await m.query(
        `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
         SELECT ancestor_id, $1, depth + 1
         FROM scope_node_closure WHERE descendant_id = $2
         ON CONFLICT DO NOTHING`,
        [id, parentId],
      );
      await m.query(
        `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
         VALUES ($1, $1, 0) ON CONFLICT DO NOTHING`,
        [id],
      );
      const rows = await m.query<ScopeNode[]>(
        `SELECT * FROM scope_nodes WHERE id = $1`,
        [id],
      );
      return rows[0];
    });
  }

  /**
   * Renames a scope node and/or toggles its tenant-boundary flag. Applies
   * only the fields present in `changes`, leaving the rest untouched.
   */
  async updateNode(
    nodeId: string,
    changes: UpdateScopeNodeInput,
  ): Promise<ScopeNode> {
    if (nodeId === GLOBAL_SCOPE_NODE_ID) {
      throw new BadRequestException('Cannot update the platform root node.');
    }
    const node = await this.nodes.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Scope node ${nodeId} not found.`);
    }
    assertValidTenantRootType(changes.isTenantRoot, node.type);

    const changedFields: string[] = [];
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    if (changes.name !== undefined) {
      previous.name = node.name;
      next.name = changes.name;
      changedFields.push('name');
      node.name = changes.name;
    }
    if (changes.isTenantRoot !== undefined) {
      previous.isTenantRoot = node.isTenantRoot;
      next.isTenantRoot = changes.isTenantRoot;
      changedFields.push('isTenantRoot');
      node.isTenantRoot = changes.isTenantRoot;
    }

    const saved = await this.nodes.save(node);

    if (changedFields.length > 0) {
      await this.authzAudit?.recordScopeUpdated({
        actorId: changes.actorId ?? 'system',
        scopeNodeId: saved.id,
        changedFields,
        previous,
        next,
      });
    }

    return saved;
  }

  async archiveNode(id: string, actorId?: string): Promise<void> {
    const node = await this.nodes.findOneBy({ id });
    if (!node) {
      throw new NotFoundException(`Scope node ${id} not found.`);
    }
    if (id === GLOBAL_SCOPE_NODE_ID) {
      throw new BadRequestException('Cannot archive the platform root node.');
    }
    if (node.type !== 'project') {
      throw new BadRequestException(
        `Only project-type nodes can be archived. Got: '${node.type}'.`,
      );
    }
    node.archivedAt = new Date();
    await this.nodes.save(node);
    await this.authzAudit?.recordScopeArchived({
      actorId: actorId ?? 'system',
      scopeNodeId: id,
    });
  }

  async restoreNode(id: string, actorId?: string): Promise<void> {
    const node = await this.nodes.findOneBy({ id });
    if (!node) {
      throw new NotFoundException(`Scope node ${id} not found.`);
    }
    if (id === GLOBAL_SCOPE_NODE_ID) {
      throw new BadRequestException('Cannot restore the platform root node.');
    }
    if (node.type !== 'project') {
      throw new BadRequestException(
        `Only project-type nodes can be restored. Got: '${node.type}'.`,
      );
    }
    node.archivedAt = null;
    await this.nodes.save(node);
    await this.authzAudit?.recordScopeRestored({
      actorId: actorId ?? 'system',
      scopeNodeId: id,
    });
  }

  async findOrphanedProjectNodes(): Promise<ScopeNode[]> {
    return this.nodes.query(
      `SELECT * FROM scope_nodes
       WHERE type = 'project'
         AND archived_at IS NULL
         AND id <> $1::uuid
         AND id NOT IN (
           SELECT scope_id FROM workflows           WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM chat_sessions        WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM scheduled_jobs       WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM automation_hooks     WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM heartbeat_profiles   WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM standing_orders      WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM workflow_run_todos   WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM notifications        WHERE scope_id IS NOT NULL
         )`,
      [GLOBAL_SCOPE_NODE_ID],
    );
  }

  /** Returns the ScopeNode entities for the given ids (empty array if ids is empty). */
  async getNodesByIds(ids: string[]): Promise<ScopeNode[]> {
    if (ids.length === 0) return [];
    return this.nodes.findBy({ id: In(ids) });
  }

  /** Returns a single scope node by id, or throws NotFoundException if absent. */
  async getNode(id: string): Promise<ScopeNode> {
    const node = await this.nodes.findOneBy({ id });
    if (!node) {
      throw new NotFoundException(`Scope node ${id} not found.`);
    }
    return node;
  }

  /**
   * Scope-node types that may be created as direct children of `nodeId`,
   * per the {@link PARENT_CHILD_TYPE_MATRIX} row for the node's own type.
   */
  async getAllowedChildTypes(nodeId: string): Promise<ScopeNodeType[]> {
    const node = await this.nodes.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Scope node ${nodeId} not found.`);
    }
    return [...PARENT_CHILD_TYPE_MATRIX[node.type]];
  }

  /**
   * Re-parents nodeId under newParentId, updating the closure table accordingly.
   *
   * The source-side `scopes:update` permission (enforced by `PermissionsGuard`
   * against `nodeId`) only proves the actor may act on the subtree being
   * moved — it says nothing about the destination. Without a destination
   * check, a tenant-scoped actor could re-parent their own subtree under the
   * global root or into a foreign tenant, escaping their governing tenant's
   * authority. `actorId` therefore must be authorized for `scopes:create`
   * (i.e. "may place a child here") at `newParentId` before the move is
   * performed.
   *
   * If `ScopeAccessService` is not injected or no `actorId` is supplied
   * (e.g. internal/system callers, or test/dev mode), the destination check
   * is skipped — mirroring the same degradation pattern used by `getTree`.
   */
  async moveNode(
    nodeId: string,
    newParentId: string,
    actorId?: string,
  ): Promise<void> {
    if (this.scopeAccessService && actorId) {
      const allowedDestinations =
        await this.scopeAccessService.restrictToAccessibleScopes(
          actorId,
          'scopes:create',
          newParentId,
        );
      if (!allowedDestinations.includes(newParentId)) {
        throw new ForbiddenException(
          'Not authorized to move a node under the requested parent',
        );
      }
    }

    const oldParentId = await this.dataSource.transaction(
      async (m: EntityManager): Promise<string | null> => {
        // Verify the target parent exists.
        const parentExists = await m.query<ExistenceRow[]>(
          `SELECT 1 FROM scope_nodes WHERE id = $1`,
          [newParentId],
        );
        if (parentExists.length === 0) {
          throw new BadRequestException(
            `Target parent node ${newParentId} does not exist.`,
          );
        }

        // Prevent cycles: newParentId must not be a descendant of nodeId.
        const cycleCheck = await m.query<ExistenceRow[]>(
          `SELECT 1 FROM scope_node_closure WHERE ancestor_id = $1 AND descendant_id = $2`,
          [nodeId, newParentId],
        );
        if (cycleCheck.length > 0) {
          throw new BadRequestException(
            `Cannot move node ${nodeId} under ${newParentId}: would create a cycle.`,
          );
        }

        // Enforce parent→child typing (SDD §2.3) on the re-parent.
        const [nodeTypeRows, parentTypeRows, currentParentRows] =
          await Promise.all([
            m.query<Array<{ type: ScopeNodeType }>>(
              `SELECT type FROM scope_nodes WHERE id = $1`,
              [nodeId],
            ),
            m.query<Array<{ type: ScopeNodeType }>>(
              `SELECT type FROM scope_nodes WHERE id = $1`,
              [newParentId],
            ),
            m.query<Array<{ parent_id: string | null }>>(
              `SELECT parent_id FROM scope_nodes WHERE id = $1`,
              [nodeId],
            ),
          ]);
        if (nodeTypeRows.length === 0) {
          throw new BadRequestException(`Scope node ${nodeId} does not exist.`);
        }
        assertValidParentChildType(
          parentTypeRows[0].type,
          nodeTypeRows[0].type,
        );

        // Remove links between this subtree and its old ancestors.
        await m.query(
          `DELETE FROM scope_node_closure
         WHERE descendant_id IN (
           SELECT descendant_id FROM scope_node_closure WHERE ancestor_id = $1
         )
         AND ancestor_id IN (
           SELECT ancestor_id FROM scope_node_closure
           WHERE descendant_id = $1 AND ancestor_id <> $1
         )`,
          [nodeId],
        );
        // Connect new parent's ancestors to this subtree.
        await m.query(
          `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
         SELECT super.ancestor_id, sub.descendant_id, super.depth + sub.depth + 1
         FROM scope_node_closure super
         CROSS JOIN scope_node_closure sub
         WHERE super.descendant_id = $1 AND sub.ancestor_id = $2
         ON CONFLICT DO NOTHING`,
          [newParentId, nodeId],
        );
        // Update the node's parent_id column.
        await m.query(`UPDATE scope_nodes SET parent_id = $1 WHERE id = $2`, [
          newParentId,
          nodeId,
        ]);

        return currentParentRows[0]?.parent_id ?? null;
      },
    );

    await this.authzAudit?.recordScopeMoved({
      actorId: actorId ?? 'system',
      scopeNodeId: nodeId,
      oldParentId,
      newParentId,
    });
  }
}
