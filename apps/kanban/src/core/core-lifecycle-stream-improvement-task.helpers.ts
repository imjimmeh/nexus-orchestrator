import type { ImprovementTaskRequestedV1 } from "@nexus/core";

/** Thrown to route an unconfigured improvement task into the consumer's dead-letter park. */
export class ImprovementTaskParkedError extends Error {}

export function severityToPriority(
  severity: ImprovementTaskRequestedV1["severity"],
): "p0" | "p1" | "p2" {
  if (severity === "critical") {
    return "p0";
  }
  if (severity === "high") {
    return "p1";
  }
  return "p2";
}

export function buildImprovementWorkItemDescription(
  payload: ImprovementTaskRequestedV1,
): string {
  const lines: string[] = [payload.description, ""];
  if (payload.suspectedArea && payload.suspectedArea.length > 0) {
    lines.push(
      "## Suspected area",
      ...payload.suspectedArea.map((area) => `- \`${area}\``),
      "",
    );
  }
  lines.push(
    "## Evidence",
    `- Run ids: ${payload.evidence.runIds.map((id) => `\`${id}\``).join(", ") || "none"}`,
    `- Failure classes: ${payload.evidence.failureClasses.join(", ") || "none"}`,
    `- Ledger refs: ${payload.evidence.ledgerRefs.join(", ") || "none"}`,
    "",
    `Occurrences: ${payload.occurrenceCount}`,
    `Source improvement proposal: ${payload.proposalId}`,
  );
  return lines.join("\n");
}
