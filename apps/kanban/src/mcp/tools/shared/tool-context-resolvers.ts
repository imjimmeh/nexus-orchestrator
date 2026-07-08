import { BadRequestException } from "@nestjs/common";

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveProjectIdFromToolContext(params: {
  projectId?: string | null;
  contextScopeId?: string | null;
  toolName: string;
}): string {
  const projectId =
    normalizeOptionalString(params.projectId) ??
    normalizeOptionalString(params.contextScopeId);

  if (!projectId) {
    throw new BadRequestException(
      `${params.toolName} requires project_id. Provide project_id in the tool arguments or run the tool from a project-scoped workflow context.`,
    );
  }

  return projectId;
}

export function resolveLinkedRunIdFromToolContext(params: {
  linkedRunId?: string | null;
  contextWorkflowRunId?: string | null;
}): string | undefined {
  return (
    normalizeOptionalString(params.linkedRunId) ??
    normalizeOptionalString(params.contextWorkflowRunId)
  );
}
