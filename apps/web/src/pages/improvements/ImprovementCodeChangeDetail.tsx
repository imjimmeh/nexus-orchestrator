import { Badge } from "@/components/ui/badge";
import type { CodeChangeProposalPayload } from "@nexus/core";

const SEVERITY_BADGE_VARIANT: Record<
  CodeChangeProposalPayload["severity"],
  "outline" | "secondary" | "default" | "destructive"
> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  critical: "destructive",
};

interface ImprovementCodeChangeDetailProps {
  payload: CodeChangeProposalPayload;
  occurrenceCount: number;
}

/** Read-only list of the evidence a `code_change` proposal was raised from. */
function CodeChangeEvidenceList({
  evidence,
}: Readonly<{ evidence: CodeChangeProposalPayload["evidence"] }>) {
  const hasEvidence =
    evidence.runIds.length > 0 ||
    evidence.failureClasses.length > 0 ||
    evidence.ledgerRefs.length > 0;
  if (!hasEvidence) {
    return null;
  }
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-medium uppercase text-muted-foreground">
        Evidence
      </h4>
      <ul className="space-y-0.5 text-xs">
        {evidence.runIds.map((runId) => (
          <li key={runId}>
            Run: <code>{runId}</code>
          </li>
        ))}
        {evidence.failureClasses.map((failureClass) => (
          <li key={failureClass}>
            Failure class: <code>{failureClass}</code>
          </li>
        ))}
        {evidence.ledgerRefs.map((ref) => (
          <li key={ref}>
            Ledger: <code>{ref}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Read-only list of source areas suspected to contain the defect. */
function CodeChangeSuspectedAreaList({ areas }: Readonly<{ areas: string[] }>) {
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-medium uppercase text-muted-foreground">
        Suspected area
      </h4>
      <ul className="space-y-0.5">
        {areas.map((area) => (
          <li key={area}>
            <code className="text-xs">{area}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Read-only detail body for a `code_change` improvement proposal: the
 * engineering brief's title/description/severity, the recurrence count (when
 * the same issue has been re-detected), the suspected source area, and the
 * evidence (run ids, failure classes, ledger refs) it was raised from.
 */
export function ImprovementCodeChangeDetail({
  payload,
  occurrenceCount,
}: Readonly<ImprovementCodeChangeDetailProps>) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{payload.title}</h3>
        <Badge variant={SEVERITY_BADGE_VARIANT[payload.severity]}>
          {payload.severity}
        </Badge>
        {occurrenceCount > 1 ? (
          <Badge variant="outline">{`seen ${occurrenceCount}×`}</Badge>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
        {payload.description}
      </p>
      {payload.suspectedArea && payload.suspectedArea.length > 0 ? (
        <CodeChangeSuspectedAreaList areas={payload.suspectedArea} />
      ) : null}
      <CodeChangeEvidenceList evidence={payload.evidence} />
    </div>
  );
}
