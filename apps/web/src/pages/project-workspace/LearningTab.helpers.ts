import { LearningCandidate, LearningCandidateStatus } from "@/lib/api/projects.types";

function toRoundedPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatLearningPercent(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "0.0%";
  }

  return toRoundedPercent(value);
}

export function formatLearningScore(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "0.000";
  }

  return value.toFixed(3);
}

export function formatLearningDateTime(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function truncateIdentifier(value: string, keep = 8): string {
  if (value.length <= keep) {
    return value;
  }

  return `${value.slice(0, keep)}...`;
}

export function formatLearningScopeLabel(params: {
  candidate: LearningCandidate;
}): string {
  if (params.candidate.scope_id) {
    return `${params.candidate.scope_type}/${truncateIdentifier(params.candidate.scope_id)}`;
  }

  return params.candidate.scope_type;
}

export function candidateStatusBadgeVariant(status: LearningCandidateStatus) {
  switch (status) {
    case "promoted":
      return "default" as const;
    case "rejected":
      return "destructive" as const;
    case "archived":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}
