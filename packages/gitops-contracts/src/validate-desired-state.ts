import type { DesiredState } from "./desired-state.schema";
import type {
  ValidationContext,
  ValidationIssue,
  ValidationResult,
} from "./validate-desired-state.types";

export type {
  ValidationContext,
  ValidationIssue,
  ValidationResult,
} from "./validate-desired-state.types";

const parentPath = (path: string): string | null => {
  if (path === "/") return null;
  const idx = path.lastIndexOf("/");
  return idx === 0 ? "/" : path.slice(0, idx);
};

function validateScopeTree(
  nodes: DesiredState["nodes"],
  nodePaths: Set<string>,
  errors: ValidationIssue[],
): void {
  const seenByParent = new Map<string, Set<string>>();
  for (const { path, doc } of nodes) {
    if (path === "/") continue;
    const parent = parentPath(path);
    if (parent !== null && !nodePaths.has(parent)) {
      errors.push({
        code: "scope.orphan_parent",
        ref: path,
        message: `parent "${parent}" is missing`,
      });
    }
    const key = parent ?? "";
    const slugs = seenByParent.get(key) ?? new Set<string>();
    if (slugs.has(doc.slug)) {
      errors.push({
        code: "scope.duplicate_slug",
        ref: path,
        message: `slug "${doc.slug}" duplicated under "${key}"`,
      });
    }
    slugs.add(doc.slug);
    seenByParent.set(key, slugs);
  }
}

function validateRoles(
  roles: DesiredState["roles"],
  nodePaths: Set<string>,
  ctx: ValidationContext,
  errors: ValidationIssue[],
): void {
  for (const role of roles) {
    for (const perm of role.permissions) {
      if (!ctx.knownPermissions.has(perm)) {
        errors.push({
          code: "role.unknown_permission",
          ref: role.name,
          message: `permission "${perm}" not in catalog`,
        });
      }
    }
    if (role.ownerScope !== null && !nodePaths.has(role.ownerScope)) {
      errors.push({
        code: "role.unknown_owner_scope",
        ref: role.name,
        message: `ownerScope "${role.ownerScope}" does not exist`,
      });
    }
  }
}

function validateAssignments(
  assignments: DesiredState["assignments"],
  nodePaths: Set<string>,
  allRoleNames: Set<string>,
  ctx: ValidationContext,
  errors: ValidationIssue[],
): void {
  for (const a of assignments) {
    if (!allRoleNames.has(a.role)) {
      errors.push({
        code: "assignment.unknown_role",
        ref: `${a.user}@${a.scope}`,
        message: `role "${a.role}" not defined`,
      });
    }
    if (!nodePaths.has(a.scope)) {
      errors.push({
        code: "assignment.unknown_scope",
        ref: `${a.user}@${a.scope}`,
        message: `scope "${a.scope}" does not exist`,
      });
    }
    if (ctx.knownUsers && !ctx.knownUsers.has(a.user)) {
      errors.push({
        code: "assignment.unknown_user",
        ref: `${a.user}@${a.scope}`,
        message: `user "${a.user}" not found`,
      });
    }
  }
}

function validateOverrides(
  list: ReadonlyArray<{ name: string; scope: string }>,
  nodePaths: Set<string>,
  defaults: Set<string>,
  label: string,
  errors: ValidationIssue[],
): void {
  for (const o of list) {
    if (!nodePaths.has(o.scope)) {
      errors.push({
        code: "override.unknown_scope",
        ref: `${label}:${o.name}@${o.scope}`,
        message: `scope "${o.scope}" does not exist`,
      });
    }
    if (!defaults.has(o.name)) {
      errors.push({
        code: "override.unknown_default",
        ref: `${label}:${o.name}`,
        message: `no platform-default ${label} named "${o.name}"`,
      });
    }
  }
}

function definitionNames(
  definitions: ReadonlyArray<{ name: string }>,
  defaults: Set<string>,
): Set<string> {
  return new Set([
    ...defaults,
    ...definitions.map((definition) => definition.name),
  ]);
}

/**
 * Pure cross-document referential-integrity checks over a schema-valid DesiredState.
 * Performs NO IO. The reconciler (204I) calls this before applying.
 */
export function validateDesiredState(
  state: DesiredState,
  ctx: ValidationContext,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const nodePaths = new Set(state.nodes.map((n) => n.path));
  const allRoleNames = new Set<string>([
    ...ctx.knownSystemRoles,
    ...state.roles.map((r) => r.name),
  ]);

  validateScopeTree(state.nodes, nodePaths, errors);
  validateRoles(state.roles, nodePaths, ctx, errors);
  validateAssignments(state.assignments, nodePaths, allRoleNames, ctx, errors);
  validateOverrides(
    state.agentOverrides,
    nodePaths,
    definitionNames(state.agents, ctx.knownDefaultAgents),
    "agent",
    errors,
  );
  validateOverrides(
    state.workflowOverrides,
    nodePaths,
    definitionNames(state.workflows, ctx.knownDefaultWorkflows),
    "workflow",
    errors,
  );
  validateOverrides(
    state.skillOverrides,
    nodePaths,
    definitionNames(state.skills, ctx.knownDefaultSkills),
    "skill",
    errors,
  );

  return { ok: errors.length === 0, errors };
}
