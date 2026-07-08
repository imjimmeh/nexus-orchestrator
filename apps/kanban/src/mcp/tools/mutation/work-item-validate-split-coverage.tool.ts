import { Injectable, BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import {
  ContextualWorkItemIdSchema,
  xmlArrayArtifact,
} from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const ChildAcAssignmentSchema = z.object({
  child_ref: z.string().optional(),
  ac_ids: xmlArrayArtifact(z.string().min(1)),
});

const WorkItemValidateSplitCoverageSchema = ContextualWorkItemIdSchema.extend({
  parent_ac_ids: xmlArrayArtifact(z.string().min(1)),
  child_ac_assignments: xmlArrayArtifact(ChildAcAssignmentSchema),
});

interface ChildAcAssignment {
  child_ref?: string;
  ac_ids: string[];
}

interface WorkItemValidateSplitCoverageParams {
  project_id?: string | null;
  workItemId: string;
  parent_ac_ids: string[];
  child_ac_assignments: ChildAcAssignment[];
}

@Injectable()
export class WorkItemValidateSplitCoverageTool extends KanbanTool<
  WorkItemValidateSplitCoverageParams,
  { ok: true; coveredCount: number }
> {
  constructor() {
    super("kanban.work_item_validate_split_coverage", {
      name: "kanban.work_item_validate_split_coverage",
      description:
        "Validate that split children collectively cover every parent acceptance criterion exactly once.",
      inputSchema: WorkItemValidateSplitCoverageSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected run(
    context: InternalToolExecutionContext,
    params: WorkItemValidateSplitCoverageParams,
  ): Promise<{ ok: true; coveredCount: number }> {
    resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const parentSet = new Set(params.parent_ac_ids);
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    const unknown = new Set<string>();

    for (const assignment of params.child_ac_assignments) {
      for (const acId of assignment.ac_ids) {
        if (!parentSet.has(acId)) {
          unknown.add(acId);
          continue;
        }
        if (seen.has(acId)) {
          duplicated.add(acId);
        }
        seen.add(acId);
      }
    }

    const uncovered = params.parent_ac_ids.filter((acId) => !seen.has(acId));

    const violations: string[] = [];
    if (uncovered.length > 0) {
      violations.push(
        `uncovered parent acceptance criteria: ${uncovered.join(", ")}`,
      );
    }
    if (duplicated.size > 0) {
      violations.push(
        `acceptance criteria duplicated across children: ${[...duplicated].join(", ")}`,
      );
    }
    if (unknown.size > 0) {
      violations.push(
        `unknown acceptance criteria not on the parent: ${[...unknown].join(", ")}`,
      );
    }

    if (violations.length > 0) {
      throw new BadRequestException(
        `Split coverage validation failed for ${params.workItemId}: ${violations.join("; ")}`,
      );
    }

    return Promise.resolve({ ok: true, coveredCount: parentSet.size });
  }
}
