import { readFile } from 'node:fs/promises';
import {
  isSessionCheckpointMarker,
  type SessionCheckpointMarker,
} from '@nexus/core';

/**
 * Reads the checkpoint sidecar JSONL at the given host path, parses every line
 * with {@link isSessionCheckpointMarker}, and returns the marker with the
 * highest `callSeq`.
 *
 * Returns `null` when the file does not exist, is empty, or contains no valid
 * markers. ENOENT is treated as expected (no checkpoints yet). All other I/O
 * errors (EACCES, EIO, EISDIR, …) are re-thrown so the caller can log them and
 * treat the read as best-effort without silently swallowing real failures.
 */
export async function readLatestMarker(
  filePath: string,
): Promise<SessionCheckpointMarker | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if (isNodeErrnoError(error) && error.code === 'ENOENT') {
      return null;
    }
    // Real I/O error (permission denied, disk error, reading a directory, …) —
    // propagate so the caller can log it and skip checkpoint persistence.
    throw error;
  }

  let best: SessionCheckpointMarker | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      // Malformed line — skip.
      continue;
    }

    if (!isSessionCheckpointMarker(parsed)) continue;

    if (best === null || parsed.callSeq > best.callSeq) {
      best = parsed;
    }
  }

  return best;
}

interface NodeErrnoError extends Error {
  code: string;
}

function isNodeErrnoError(error: unknown): error is NodeErrnoError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as Record<string, unknown>)['code'] === 'string'
  );
}
