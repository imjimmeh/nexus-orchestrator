import { DiffEditor } from "@monaco-editor/react";
import {
  WorkflowDefinitionChangePayloadSchema,
  type WorkflowChangeSummaryEntry,
} from "@nexus/core";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkflowYamlForDiff } from "@/hooks/useImprovementProposalDetail";
import { ProposalRollbackButton } from "./ProposalRollbackButton";

export interface WorkflowDefinitionChangeDetailProps {
  proposal: ImprovementProposal;
}

/**
 * Readable detail view for `workflow_definition_change` proposals: the
 * target workflow, a `changeSummary` table, and a side-by-side YAML diff
 * (pre-apply baseline versus proposed) when a baseline is resolvable —
 * falling back to a plain preview of the proposed YAML otherwise. Also hosts
 * the rollback control once the proposal has applied.
 */
export function WorkflowDefinitionChangeDetail({
  proposal,
}: WorkflowDefinitionChangeDetailProps) {
  const parsedPayload = WorkflowDefinitionChangePayloadSchema.safeParse(
    proposal.payload,
  );
  const { originalYaml } = useWorkflowYamlForDiff(proposal);

  if (!parsedPayload.success) {
    return (
      <p className="text-sm text-destructive">
        Malformed workflow_definition_change payload:{" "}
        {parsedPayload.error.message}
      </p>
    );
  }

  const payload = parsedPayload.data;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Target workflow
          </h4>
          <p className="text-sm font-medium">
            {payload.workflowName ?? payload.workflowId}
          </p>
        </div>
        <ProposalRollbackButton proposal={proposal} />
      </div>

      <ChangeSummaryTable entries={payload.changeSummary} />

      {originalYaml !== undefined ? (
        <div className="overflow-x-auto rounded-md border">
          <DiffEditor
            height="360px"
            original={originalYaml}
            modified={payload.proposedYaml}
            language="yaml"
            options={{ readOnly: true, renderSideBySide: true }}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            No prior YAML snapshot is available to diff against — showing the
            proposed definition only.
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {payload.proposedYaml}
          </pre>
        </div>
      )}
    </div>
  );
}

function ChangeSummaryTable({
  entries,
}: {
  entries: WorkflowChangeSummaryEntry[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Step</TableHead>
          <TableHead>Field</TableHead>
          <TableHead>From</TableHead>
          <TableHead>To</TableHead>
          <TableHead>Rationale</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry, index) => (
          <TableRow key={`${entry.field}-${index}`}>
            <TableCell className="font-mono text-xs">
              {entry.stepId ?? "—"}
            </TableCell>
            <TableCell>{entry.field}</TableCell>
            <TableCell>{entry.from}</TableCell>
            <TableCell>{entry.to}</TableCell>
            <TableCell className="text-muted-foreground">
              {entry.rationale}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
