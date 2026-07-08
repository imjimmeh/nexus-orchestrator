import { z } from "zod";
import { ScopeNodeDocSchema } from "./scope.schema";
import { RoleDocSchema, AssignmentDocSchema } from "./rbac.schema";
import {
  AgentProfileDocSchema,
  WorkflowDocSchema,
  SkillDocSchema,
  AgentOverrideDocSchema,
  WorkflowOverrideDocSchema,
  SkillOverrideDocSchema,
} from "./overrides.schema";
import { DesiredStateSchema, type DesiredState } from "./desired-state.schema";
import { GITOPS_API_VERSION } from "./common.schema";
import type { DesiredStateFile, ParseResult } from "./desired-state.types";

export type { DesiredStateFile, ParseResult } from "./desired-state.types";

export const GITOPS_LAYOUT = {
  manifest: "gitops.yaml",
  scopesDir: "scopes",
  rolesDir: "roles",
  assignmentsFile: "assignments.yaml",
  scopeFile: "scope.yaml",
  agentsDir: "agents",
  workflowsDir: "workflows",
  skillsDir: "skills",
} as const;

/** "/" -> "scopes/scope.yaml"; "/acme/emea" -> "scopes/acme/emea/scope.yaml". */
function scopeFilePath(path: string): string {
  if (path === "/")
    return `${GITOPS_LAYOUT.scopesDir}/${GITOPS_LAYOUT.scopeFile}`;
  return `${GITOPS_LAYOUT.scopesDir}${path}/${GITOPS_LAYOUT.scopeFile}`;
}

/** Inverse of scopeFilePath: "scopes/scope.yaml" -> "/"; "scopes/acme/scope.yaml" -> "/acme". */
function scopeDirOf(filePath: string): string {
  const rel = filePath
    .slice(GITOPS_LAYOUT.scopesDir.length)
    .replace(`/${GITOPS_LAYOUT.scopeFile}`, "");
  return rel === "" ? "/" : rel;
}

export function serializeDesiredState(state: DesiredState): DesiredStateFile[] {
  const files: DesiredStateFile[] = [];

  for (const node of state.nodes) {
    files.push({ path: scopeFilePath(node.path), content: node.doc });
  }

  for (const role of state.roles) {
    files.push({
      path: `${GITOPS_LAYOUT.rolesDir}/${role.name}.yaml`,
      content: role,
    });
  }

  files.push({
    path: GITOPS_LAYOUT.assignmentsFile,
    content: {
      apiVersion: GITOPS_API_VERSION,
      kind: "AssignmentList",
      assignments: state.assignments,
    },
  });

  for (const agent of state.agents) {
    files.push({
      path: `${GITOPS_LAYOUT.agentsDir}/${agent.name}.yaml`,
      content: agent,
    });
  }
  for (const workflow of state.workflows) {
    files.push({
      path: `${GITOPS_LAYOUT.workflowsDir}/${workflow.name}.yaml`,
      content: workflow,
    });
  }
  for (const skill of state.skills) {
    files.push({
      path: `${GITOPS_LAYOUT.skillsDir}/${skill.name}.yaml`,
      content: skill,
    });
  }

  const overrideDir = (scope: string, dir: string): string =>
    scope === "/"
      ? `${GITOPS_LAYOUT.scopesDir}/${dir}`
      : `${GITOPS_LAYOUT.scopesDir}${scope}/${dir}`;

  for (const o of state.agentOverrides) {
    files.push({
      path: `${overrideDir(o.scope, GITOPS_LAYOUT.agentsDir)}/${o.name}.yaml`,
      content: o,
    });
  }
  for (const o of state.workflowOverrides) {
    files.push({
      path: `${overrideDir(o.scope, GITOPS_LAYOUT.workflowsDir)}/${o.name}.yaml`,
      content: o,
    });
  }
  for (const o of state.skillOverrides) {
    files.push({
      path: `${overrideDir(o.scope, GITOPS_LAYOUT.skillsDir)}/${o.name}.yaml`,
      content: o,
    });
  }

  return files;
}

type TryParse = <T>(
  schema: z.ZodType<T>,
  file: DesiredStateFile,
) => T | undefined;

function dispatchPlatformConfigFile(
  file: DesiredStateFile,
  draft: DesiredState,
  tryParse: TryParse,
): boolean {
  const { path } = file;
  if (path.startsWith(`${GITOPS_LAYOUT.agentsDir}/`)) {
    const doc = tryParse(AgentProfileDocSchema, file);
    if (doc) draft.agents.push(doc);
    return true;
  }
  if (path.startsWith(`${GITOPS_LAYOUT.workflowsDir}/`)) {
    const doc = tryParse(WorkflowDocSchema, file);
    if (doc) draft.workflows.push(doc);
    return true;
  }
  if (path.startsWith(`${GITOPS_LAYOUT.skillsDir}/`)) {
    const doc = tryParse(SkillDocSchema, file);
    if (doc) draft.skills.push(doc);
    return true;
  }
  return false;
}

function dispatchScopedConfigFile(
  file: DesiredStateFile,
  draft: DesiredState,
  tryParse: TryParse,
): boolean {
  const { path } = file;
  if (path.includes(`/${GITOPS_LAYOUT.agentsDir}/`)) {
    const doc = tryParse(AgentOverrideDocSchema, file);
    if (doc) draft.agentOverrides.push(doc);
    return true;
  }
  if (path.includes(`/${GITOPS_LAYOUT.workflowsDir}/`)) {
    const doc = tryParse(WorkflowOverrideDocSchema, file);
    if (doc) draft.workflowOverrides.push(doc);
    return true;
  }
  if (path.includes(`/${GITOPS_LAYOUT.skillsDir}/`)) {
    const doc = tryParse(SkillOverrideDocSchema, file);
    if (doc) draft.skillOverrides.push(doc);
    return true;
  }
  return false;
}

function dispatchFile(
  file: DesiredStateFile,
  draft: DesiredState,
  tryParse: TryParse,
): void {
  const { path } = file;
  if (path === GITOPS_LAYOUT.manifest) return;
  if (path.endsWith(`/${GITOPS_LAYOUT.scopeFile}`)) {
    const doc = tryParse(ScopeNodeDocSchema, file);
    if (doc) draft.nodes.push({ path: scopeDirOf(path), doc });
  } else if (path === GITOPS_LAYOUT.assignmentsFile) {
    const doc = tryParse(AssignmentDocSchema, file);
    if (doc) draft.assignments.push(...doc.assignments);
  } else if (path.startsWith(`${GITOPS_LAYOUT.rolesDir}/`)) {
    const doc = tryParse(RoleDocSchema, file);
    if (doc) draft.roles.push(doc);
  } else if (dispatchPlatformConfigFile(file, draft, tryParse)) {
    return;
  } else if (dispatchScopedConfigFile(file, draft, tryParse)) {
    return;
  }
  // bodyRef sidecars (*.PROMPT.md / *.body.yaml / *.SKILL.md) are not docs; ignored here.
}

export function parseDesiredStateFiles(files: DesiredStateFile[]): ParseResult {
  const errors: Array<{ path: string; message: string }> = [];
  const draft: DesiredState = {
    apiVersion: GITOPS_API_VERSION,
    nodes: [],
    roles: [],
    assignments: [],
    agents: [],
    workflows: [],
    skills: [],
    agentOverrides: [],
    workflowOverrides: [],
    skillOverrides: [],
  };

  const tryParse = <T>(
    schema: z.ZodType<T>,
    file: DesiredStateFile,
  ): T | undefined => {
    const r = schema.safeParse(file.content);
    if (!r.success) {
      errors.push({
        path: file.path,
        message: r.error.issues.map((i) => i.message).join("; "),
      });
      return undefined;
    }
    return r.data;
  };

  for (const file of files) {
    dispatchFile(file, draft, tryParse);
  }

  if (errors.length > 0) return { ok: false, errors };

  const final = DesiredStateSchema.safeParse(draft);
  if (!final.success) {
    return {
      ok: false,
      errors: [
        {
          path: "<aggregate>",
          message: final.error.issues.map((i) => i.message).join("; "),
        },
      ],
    };
  }

  return { ok: true, state: final.data };
}
