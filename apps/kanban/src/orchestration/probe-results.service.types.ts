export type ProbeResultOutcome =
  | "success"
  | "failed"
  | "cancelled"
  | "timed_out";

export type RecordProbeResultInput = {
  projectId: string;
  probeScopeId: string;
  outcome: ProbeResultOutcome;
  result: unknown;
  recordedAt: string;
  probeType?: string;
  expectedOutputSchema?: unknown;
  evidenceRefs?: string[];
  narrativeSummary?: string;
};

export type RecordProbeResultResult =
  | { ok: true }
  | { ok: false; reason: "orchestration_not_found" };
