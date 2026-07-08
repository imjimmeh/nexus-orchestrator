export interface ControlPlaneBoardResponse {
  projectId: string;
  generatedAt: string;
  lanes: ControlPlaneBoardLane[];
  facts: ControlPlaneBoardFact[];
  noLaunchReasons: ControlPlaneBoardOutcome[];
  staleLinks: ControlPlaneBoardFact[];
}

export interface ControlPlaneBoardLane {
  lane: string;
  activeCount: number;
  pendingCount: number;
  blockedCount: number;
  intents: ControlPlaneBoardIntent[];
}

export interface ControlPlaneBoardIntent {
  id: string;
  lane: string;
  type: string;
  status: string;
  priority: number;
  reason: string;
  workflowId: string | null;
  workflowScope: string | null;
  conflictKeys: Array<{ kind: string; value: string }>;
  latestOutcome: ControlPlaneBoardOutcome | null;
  launchAttempts: ControlPlaneBoardLaunchAttempt[];
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneBoardOutcome {
  id: string;
  status: string;
  reason: string;
  activeConflicts: Array<{ kind: string; value: string }>;
  evaluatedAt: string;
}

export interface ControlPlaneBoardLaunchAttempt {
  id: string;
  workflowId: string;
  workflowRunId: string | null;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

export interface ControlPlaneBoardFact {
  id: string;
  type: string;
  subjectKind: string;
  subjectId: string;
  confidence: number;
  freshnessStatus: string;
  observedAt: string;
  expiresAt: string | null;
}
