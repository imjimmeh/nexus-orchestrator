import type { HarnessId } from "@nexus/core";

export interface CheckpointWiringOptions {
  harnessId: HarnessId;
  /** SESSION_CHECKPOINT_PATH value from environment; undefined means feature is disabled. */
  checkpointPath: string | undefined;
}
