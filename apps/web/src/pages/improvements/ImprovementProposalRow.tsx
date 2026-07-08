import { Fragment } from "react";
import { CodeChangeProposalPayloadSchema } from "@nexus/core";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { AgentProfileChangeDetail } from "./AgentProfileChangeDetail";
import { ImprovementCodeChangeDetail } from "./ImprovementCodeChangeDetail";
import { SkillProposalDetail } from "./SkillProposalDetail";
import { WorkflowDefinitionChangeDetail } from "./WorkflowDefinitionChangeDetail";

const SKILL_KIND_PROPOSAL_KINDS = new Set(["skill_create", "skill_assignment"]);

/** Raw-JSON fallback for proposal kinds without a dedicated detail view, or a malformed payload for a kind that has one. */
function RawProposalDetail({ proposal }: { proposal: ImprovementProposal }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(
        { kind: proposal.kind, payload: proposal.payload },
        null,
        2,
      )}
    </pre>
  );
}

/** Renders the expanded detail view a `code_change` proposal maps to, falling back to the raw-JSON view when the payload fails schema validation. */
function CodeChangeProposalDetail({
  proposal,
}: {
  proposal: ImprovementProposal;
}) {
  const parsedPayload = CodeChangeProposalPayloadSchema.safeParse(
    proposal.payload,
  );
  if (!parsedPayload.success) {
    return <RawProposalDetail proposal={proposal} />;
  }
  return (
    <ImprovementCodeChangeDetail
      payload={parsedPayload.data}
      occurrenceCount={proposal.occurrence_count}
    />
  );
}

/** Renders the expanded detail view a proposal's `kind` maps to, falling back to the Epic A raw-JSON stub for kinds without a dedicated view yet. */
function ProposalDetail({ proposal }: { proposal: ImprovementProposal }) {
  if (SKILL_KIND_PROPOSAL_KINDS.has(proposal.kind)) {
    return <SkillProposalDetail proposal={proposal} />;
  }
  if (proposal.kind === "agent_profile_change") {
    return <AgentProfileChangeDetail proposal={proposal} />;
  }
  if (proposal.kind === "workflow_definition_change") {
    return <WorkflowDefinitionChangeDetail proposal={proposal} />;
  }
  if (proposal.kind === "code_change") {
    return <CodeChangeProposalDetail proposal={proposal} />;
  }
  return <RawProposalDetail proposal={proposal} />;
}

export interface ImprovementProposalRowProps {
  proposal: ImprovementProposal;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onToggleExpanded: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

/**
 * A single improvement-proposal row plus its expandable detail row. The
 * `occurrence_count` badge (rendered next to the kind, and again inside the
 * expanded detail for `code_change`) surfaces recurring issues. `skill_create`
 * / `skill_assignment` proposals render the readable {@link SkillProposalDetail}
 * view (Epic B); `agent_profile_change` / `workflow_definition_change` render
 * {@link AgentProfileChangeDetail} / {@link WorkflowDefinitionChangeDetail}
 * (Epic D); `code_change` renders {@link ImprovementCodeChangeDetail} (Epic
 * E); every other kind still falls back to the Epic A raw-JSON stub until
 * later epics add their own views.
 */
export function ImprovementProposalRow({
  proposal,
  isSelected,
  isExpanded,
  onToggleSelected,
  onToggleExpanded,
  onApprove,
  onReject,
}: ImprovementProposalRowProps) {
  const isPending = proposal.status === "pending";

  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) =>
              onToggleSelected(proposal.id, checked === true)
            }
            aria-label={`Select proposal ${proposal.id}`}
          />
        </TableCell>
        <TableCell
          className="cursor-pointer font-medium"
          onClick={() => onToggleExpanded(proposal.id)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span>{proposal.kind}</span>
            {proposal.occurrence_count > 1 ? (
              <Badge variant="outline">{`seen ${proposal.occurrence_count}×`}</Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={isPending ? "secondary" : "default"}>
            {proposal.status}
          </Badge>
        </TableCell>
        <TableCell>{proposal.confidence}</TableCell>
        <TableCell>{new Date(proposal.created_at).toLocaleString()}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!isPending}
              onClick={() => onApprove(proposal.id)}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!isPending}
              onClick={() => onReject(proposal.id)}
            >
              Reject
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={6}>
            <ProposalDetail proposal={proposal} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
