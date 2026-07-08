import type { AssignmentTarget } from "@nexus/core";
import { Badge } from "@/components/ui/badge";
import { describeAssignmentTarget } from "./skill-proposal-detail.helpers";
import type { UnroutedSkillAssignmentTarget } from "./skill-proposal-detail.types";

/**
 * Mirrors `UI_OPERATOR_PROVENANCE_SOURCE`
 * (`apps/api/src/improvement/improvement-proposal-provenance.constants.ts`) —
 * kept as a web-local literal (rather than a cross-package export) since
 * this is the only place the web layer needs to recognize the marker.
 */
const UI_OPERATOR_PROVENANCE_SOURCE = "ui_operator";

export interface SkillBindingProvenanceProps {
  appliedTargets: AssignmentTarget[];
  unroutedTargets: UnroutedSkillAssignmentTarget[];
  /** `proposal.provenance.source`, when present as a string. */
  provenanceSource?: string | null;
}

/**
 * Renders which assignment targets were actually bound versus which could
 * not be routed, once a `skill_create`/`skill_assignment` proposal has
 * applied — the human-facing record of binding provenance the applier
 * persisted to `rollback_data`. Also labels the assignment as
 * operator-directed when it was created via the "Assign skill" UI flow
 * (FU-10/PD-4) rather than the `suggest_skill_assignment` agent tool.
 */
export function SkillBindingProvenance({
  appliedTargets,
  unroutedTargets,
  provenanceSource,
}: SkillBindingProvenanceProps) {
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Binding provenance
        </h4>
        {provenanceSource === UI_OPERATOR_PROVENANCE_SOURCE && (
          <Badge variant="outline">Operator-directed</Badge>
        )}
      </div>
      <div>
        <p className="text-sm font-medium">Applied</p>
        {appliedTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">None applied</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {appliedTargets.map((target, index) => (
              <li key={`applied-${index}`}>
                <Badge variant="success">
                  {describeAssignmentTarget(target)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-sm font-medium">Unrouted</p>
        {unroutedTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">None unrouted</p>
        ) : (
          <ul className="space-y-1">
            {unroutedTargets.map(({ target, reason }, index) => (
              <li key={`unrouted-${index}`} className="text-sm">
                <Badge variant="error">
                  {describeAssignmentTarget(target)}
                </Badge>{" "}
                <span className="text-muted-foreground">{reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
