import { WorkItem } from "@/lib/api/work-items.types";
import { Label } from "@/components/ui/label";

interface WorkItemPreflightSummary {
  pmSummary?: string;
  acceptanceClarifications?: string[];
  architectSummary?: string;
  sddTargets?: string[];
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return strings.length > 0 ? strings : undefined;
}

function resolvePreflightSummary(
  item: WorkItem,
): WorkItemPreflightSummary | null {
  if (!item.metadata || typeof item.metadata !== "object") {
    return null;
  }

  const preflight = (item.metadata as Record<string, unknown>).preflight;
  if (!preflight || typeof preflight !== "object") {
    return null;
  }

  const record = preflight as Record<string, unknown>;
  const summary: WorkItemPreflightSummary = {
    pmSummary: readOptionalString(record.pmSummary),
    acceptanceClarifications: readOptionalStringArray(
      record.acceptanceClarifications,
    ),
    architectSummary: readOptionalString(record.architectSummary),
    sddTargets: readOptionalStringArray(record.sddTargets),
  };

  if (
    !summary.pmSummary &&
    !summary.acceptanceClarifications &&
    !summary.architectSummary &&
    !summary.sddTargets
  ) {
    return null;
  }

  return summary;
}

export function WorkItemPreflightSummarySection({
  item,
}: Readonly<{ item: WorkItem }>) {
  const preflightSummary = resolvePreflightSummary(item);
  if (!preflightSummary) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">Pre-flight Summary</Label>
      {preflightSummary.pmSummary && (
        <p className="text-sm">
          <span className="font-medium">PM:</span> {preflightSummary.pmSummary}
        </p>
      )}
      {preflightSummary.acceptanceClarifications && (
        <div>
          <p className="text-sm font-medium">Acceptance Clarifications</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {preflightSummary.acceptanceClarifications.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
      {preflightSummary.architectSummary && (
        <p className="text-sm">
          <span className="font-medium">Architect:</span>{" "}
          {preflightSummary.architectSummary}
        </p>
      )}
      {preflightSummary.sddTargets && (
        <div>
          <p className="text-sm font-medium">SDD Targets</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {preflightSummary.sddTargets.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
