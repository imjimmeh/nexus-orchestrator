import type {
  SessionCheckpointMarker,
  HarnessSessionRef,
  HarnessId,
} from "@nexus/core";

export interface CheckpointSink {
  /**
   * Persist a checkpoint marker. The writer invokes this on each
   * tool_execution_start/end but does NOT block the harness engine on the
   * returned promise — capture is non-blocking. True "intent durable before the
   * tool side effect" gating is a deeper integration handled outside this writer
   * (see SDD-exact-point-session-resume.md §6); a sink may still flush durably
   * (e.g. fsync) so a reaped container retains the latest marker.
   */
  write(marker: SessionCheckpointMarker): Promise<void>;
}

export interface SessionCheckpointWriterOptions {
  engine: HarnessId;
  getSessionRef: () => HarnessSessionRef | null;
}
