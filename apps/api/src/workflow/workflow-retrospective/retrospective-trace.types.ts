export interface RetrospectiveFindingTraceItem {
  index: number;
  originalRunId: string | null;
  outcome: string | null;
  reasonCode: string | null;
  candidateId: string | null;
  skillProposalId: string | null;
}

export interface RetrospectiveTrace {
  workflowRunId: string;
  findingsTotal: number;
  outcomes: Record<string, number>;
  findings: RetrospectiveFindingTraceItem[];
}
