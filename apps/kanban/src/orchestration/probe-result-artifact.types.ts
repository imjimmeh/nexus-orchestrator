export interface ProbeResultArtifact {
  path: string;
  projectScopeId?: string;
  probeScopeId?: string;
  outcome?: string;
  inferredStatus?: string;
  confidenceScore?: number;
  evidenceRefs: string[];
  sourcePaths: string[];
  narrativeSummary?: string;
  capabilityUpdates?: string;
  healthFindings?: string;
  openQuestions?: string;
}

export interface ProbeResultValidationFailure {
  ok: false;
  path: string;
  missingFields: string[];
  errors: string[];
}

export interface ProbeResultValidationSuccess {
  ok: true;
  value: ProbeResultArtifact;
}

export type ProbeResultValidationResult =
  | ProbeResultValidationSuccess
  | ProbeResultValidationFailure;
