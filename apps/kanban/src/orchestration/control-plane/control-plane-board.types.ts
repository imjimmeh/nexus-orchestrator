export interface ControlPlaneBoardConflictKey {
  readonly kind: string;
  readonly value: string;
}

export interface ControlPlaneBoardIntent {
  readonly id: string;
  readonly lane: string;
  readonly type: string;
  readonly status: string;
  readonly priority: number;
  readonly reason: string;
  readonly workflowId: string | null;
  readonly workflowScope: string | null;
  readonly conflictKeys: ControlPlaneBoardConflictKey[];
  readonly latestOutcome: ControlPlaneBoardOutcome | null;
  readonly launchAttempts: ControlPlaneBoardLaunchAttempt[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ControlPlaneBoardOutcome {
  readonly id: string;
  readonly status: string;
  readonly reason: string;
  readonly activeConflicts: ControlPlaneBoardConflictKey[];
  readonly evaluatedAt: string;
}

export interface ControlPlaneBoardLaunchAttempt {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowRunId: string | null;
  readonly status: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly failureReason: string | null;
}

export interface ControlPlaneBoardFact {
  readonly id: string;
  readonly type: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly confidence: number;
  readonly freshnessStatus: string;
  readonly observedAt: string;
  readonly expiresAt: string | null;
}

export interface ControlPlaneBoardLane {
  readonly lane: string;
  readonly activeCount: number;
  readonly pendingCount: number;
  readonly blockedCount: number;
  readonly intents: ControlPlaneBoardIntent[];
}

export interface ControlPlaneBoardResponse {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly lanes: ControlPlaneBoardLane[];
  readonly facts: ControlPlaneBoardFact[];
  readonly noLaunchReasons: ControlPlaneBoardOutcome[];
  readonly staleLinks: ControlPlaneBoardFact[];
}
