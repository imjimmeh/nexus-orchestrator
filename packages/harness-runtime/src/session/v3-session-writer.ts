import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type {
  V3NodePayload,
  V3WriterOptions,
} from "./v3-session-writer.types.js";

/**
 * Writes a pi-coding-agent "v3" session JSONL: a `session` header followed by
 * one node per line, each chained to the previous via `parentId`. Engine-agnostic
 * — callers supply already-shaped node payloads. The writer owns id/parentId/
 * timestamp assignment so the output matches what the pi SDK produces and passes
 * the API's JSONL/tree validation.
 */
export class V3SessionWriter {
  private parentId: string | null = null;

  private constructor(
    private readonly sessionPath: string,
    private readonly opts: V3WriterOptions,
  ) {}

  /** Starts a fresh session file with a v3 `session` header line. */
  static create(
    sessionPath: string,
    cwd: string,
    opts: V3WriterOptions,
  ): V3SessionWriter {
    const writer = new V3SessionWriter(sessionPath, opts);
    const header = {
      type: "session",
      version: 3,
      id: opts.genId(),
      timestamp: opts.now(),
      cwd,
    };
    writeFileSync(sessionPath, JSON.stringify(header) + "\n");
    return writer;
  }

  /** Re-opens an existing session file, continuing the chain from the last node. */
  static open(sessionPath: string, opts: V3WriterOptions): V3SessionWriter {
    const writer = new V3SessionWriter(sessionPath, opts);
    const lines = readFileSync(sessionPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    const last = lines.length
      ? (JSON.parse(lines[lines.length - 1]) as { id?: string })
      : undefined;
    writer.parentId = last?.id ?? null;
    return writer;
  }

  /** Appends one node, assigning id/parentId/timestamp. Returns the new node id. */
  appendNode(payload: V3NodePayload): string {
    const id = this.opts.genId();
    const node = {
      ...payload,
      id,
      parentId: this.parentId,
      timestamp: this.opts.now(),
    };
    appendFileSync(this.sessionPath, JSON.stringify(node) + "\n");
    this.parentId = id;
    return id;
  }
}
