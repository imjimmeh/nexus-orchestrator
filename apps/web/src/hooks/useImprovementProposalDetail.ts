import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import type { WorkflowYamlForDiff } from "./useImprovementProposalDetail.types";

export type { WorkflowYamlForDiff };

/**
 * Reads the `yaml_definition` string a `rollback_data` snapshot carries for
 * an applied/rolled-back `workflow_definition_change` proposal, if present.
 */
function readSnapshotYaml(
  rollbackData: ImprovementProposal["rollback_data"],
): string | undefined {
  if (!rollbackData) {
    return undefined;
  }
  const yamlDefinition = rollbackData.yaml_definition;
  return typeof yamlDefinition === "string" ? yamlDefinition : undefined;
}

/** Reads the target workflow id a `workflow_definition_change` payload carries. */
function readPayloadWorkflowId(
  payload: ImprovementProposal["payload"],
): string | undefined {
  const workflowId = payload.workflowId;
  return typeof workflowId === "string" ? workflowId : undefined;
}

/**
 * Resolves the "original" (pre-change) YAML a `workflow_definition_change`
 * proposal's diff view (Task 11) should render against.
 *
 * Decision cascade:
 * 1. `rollback_data.yaml_definition` — once a proposal has applied (or been
 *    rolled back), this is the true pre-apply snapshot and always wins.
 * 2. `payload.workflowId` — for a still-pending proposal, fetch the
 *    workflow's current YAML as the diff baseline.
 * 3. Neither is available — the caller falls back to a plain (non-diff) YAML
 *    view.
 */
export function useWorkflowYamlForDiff(
  proposal: ImprovementProposal,
): WorkflowYamlForDiff {
  const snapshotYaml = readSnapshotYaml(proposal.rollback_data);
  const workflowId = readPayloadWorkflowId(proposal.payload);
  const shouldFetchWorkflow = snapshotYaml === undefined && Boolean(workflowId);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workflows.detail(workflowId ?? ""),
    queryFn: () => api.getWorkflow(workflowId as string),
    enabled: shouldFetchWorkflow,
  });

  if (snapshotYaml !== undefined) {
    return { originalYaml: snapshotYaml, isLoading: false };
  }

  return {
    originalYaml: data?.yaml_definition,
    isLoading: shouldFetchWorkflow && isLoading,
  };
}
