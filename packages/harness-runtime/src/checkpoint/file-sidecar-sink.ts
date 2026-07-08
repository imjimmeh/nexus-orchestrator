import { open } from "node:fs/promises";
import type { SessionCheckpointMarker } from "@nexus/core";
import type { CheckpointSink } from "./session-checkpoint-writer.types.js";

/**
 * Checkpoint sink that appends each marker as a JSON line to a sidecar file,
 * calling fsync after each write so the marker survives a subsequent SIGKILL.
 */
export class FileSidecarSink implements CheckpointSink {
  constructor(private readonly path: string) {}

  async write(marker: SessionCheckpointMarker): Promise<void> {
    const handle = await open(this.path, "a");
    try {
      await handle.appendFile(JSON.stringify(marker) + "\n");
      await handle.sync(); // durable before we return — survives a later SIGKILL
    } finally {
      await handle.close();
    }
  }
}
