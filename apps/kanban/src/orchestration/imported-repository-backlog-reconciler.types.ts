import type { FailureClass } from "@nexus/core";
import type { ProbeResultArtifact } from "./probe-result-artifact.types";
import type {
  KanbanOrchestrationMode,
  HumanDecisionPolicy,
} from "./human-decision-resolution-policy.types";

export type WorkItemStatus = "done" | "todo" | "blocked";
export type WorkType =
  | "existing_capability"
  | "gap"
  | "bug"
  | "test"
  | "docs"
  | "architecture"
  | "investigation"
  | "human_decision";

export interface RepositoryWorkItemSpec {
  sourceId: string;
  status: WorkItemStatus;
  workType: WorkType;
  title: string;
  reason: string;
  evidence: {
    artifactPath: string;
    probeScopeId?: string;
    evidenceRefs: string[];
    sourcePaths: string[];
    confidenceScore?: number;
    projectScopeId?: string;
    outcome?: string;
    inferredStatus?: string;
    narrativeSummary?: string;
    capabilityUpdates?: string;
    healthFindings?: string;
    openQuestions?: string;
  };
  metadata: {
    sourceHash: string;
    [key: string]: unknown;
  };
}

export interface ImportedRepositoryBacklogReconcilerInput {
  projectId: string;
  artifacts: ProbeResultArtifact[];
  orchestrationMode?: KanbanOrchestrationMode;
  humanDecisionPolicy?: HumanDecisionPolicy;
}

export type OrchestrationCycleDecision = {
  decision: "repeat" | "pause" | "complete" | "blocked";
  reason: string;
  readyForCycle: boolean;
  /**
   * Optional discriminator classifying the failure when the cycle
   * decision represents a failure. Only the classes that count
   * toward the threshold (see `shouldCountFailure`) actually
   * increment the consecutive-failure counter.
   *
   * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
   */
  failureClass?: FailureClass;
};

export interface ImportedRepositoryBacklogReconciliationPlan {
  specs: RepositoryWorkItemSpec[];
  findings: RepositoryWorkItemSpec[];
  counts: {
    total: number;
    done: number;
    todo: number;
    blocked: number;
  };
  summary: string;
  diagnostics: {
    artifactCount: number;
    mappedSpecs: number;
    mappedFindings: number;
  };
  cycleDecision: OrchestrationCycleDecision;
  openQuestions: string[];
}
