// packages/gitops-contracts/src/validate-desired-state.types.ts

export interface ValidationContext {
  knownPermissions: Set<string>;
  knownSystemRoles: Set<string>;
  /** Optional: usernames are resolved on apply (204I); warn-only if absent. */
  knownUsers?: Set<string>;
  knownDefaultAgents: Set<string>;
  knownDefaultWorkflows: Set<string>;
  knownDefaultSkills: Set<string>;
}

export interface ValidationIssue {
  code: string;
  message: string;
  /** The file/object the issue is about (path or name), for actionable lint output. */
  ref: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}
