import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { SkillAssignmentTargetList } from "./SkillAssignmentTargetList";
import { SkillBindingProvenance } from "./SkillBindingProvenance";
import { getSkillProposalDetailData } from "./skill-proposal-detail.helpers";

export interface SkillProposalDetailProps {
  proposal: ImprovementProposal;
}

/**
 * Readable detail view for `skill_create` / `skill_assignment` proposals,
 * replacing the Epic A raw-JSON stub in the Improvements queue's expandable
 * row. Shows the skill name, the create summary/patch (create only), the
 * requested assignment targets, and — once the proposal has applied — the
 * binding provenance (applied versus unrouted targets).
 */
export function SkillProposalDetail({ proposal }: SkillProposalDetailProps) {
  const detail = getSkillProposalDetailData(proposal);
  const isCreate = proposal.kind === "skill_create";

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Skill
        </h4>
        <p className="text-sm font-medium">
          {detail.skillName ?? "(no skill name)"}
        </p>
      </div>

      {isCreate && <SkillCreatePreview detail={detail} />}

      <SkillAssignmentTargetList
        title="Requested assignment targets"
        targets={detail.assignmentTargets}
        emptyLabel="No assignment targets requested"
      />

      {detail.hasBindingProvenance && (
        <SkillBindingProvenance
          appliedTargets={detail.appliedTargets}
          unroutedTargets={detail.unroutedTargets}
          provenanceSource={
            typeof proposal.provenance?.source === "string"
              ? proposal.provenance.source
              : null
          }
        />
      )}
    </div>
  );
}

function SkillCreatePreview({
  detail,
}: {
  detail: ReturnType<typeof getSkillProposalDetailData>;
}) {
  return (
    <div className="space-y-2">
      {detail.proposalSummary && (
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Summary
          </h4>
          <p className="text-sm">{detail.proposalSummary}</p>
        </div>
      )}
      {detail.patchMarkdown && (
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Proposed skill content
          </h4>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {detail.patchMarkdown}
          </pre>
        </div>
      )}
    </div>
  );
}
