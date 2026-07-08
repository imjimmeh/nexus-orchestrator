import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLatestMarker } from './checkpoint-marker-reader.js';

describe('readLatestMarker', () => {
  it('returns the highest-callSeq marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ck-'));
    const path = join(dir, 'checkpoints.jsonl');
    await writeFile(
      path,
      `{"engine":"pi","phase":"result","callSeq":1}\n{"engine":"pi","phase":"intent","callSeq":2,"toolName":"fs.write"}\n`,
    );
    const m = await readLatestMarker(path);
    expect(m?.callSeq).toBe(2);
    expect(m?.phase).toBe('intent');
  });

  it('returns null when the sidecar is absent', async () => {
    expect(await readLatestMarker('/no/such/file.jsonl')).toBeNull();
  });

  it('returns null for an empty file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ck-'));
    const path = join(dir, 'checkpoints.jsonl');
    await writeFile(path, '');
    expect(await readLatestMarker(path)).toBeNull();
  });

  it('skips malformed lines and returns the best valid marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ck-'));
    const path = join(dir, 'checkpoints.jsonl');
    await writeFile(
      path,
      `not-json\n{"engine":"claude-code","phase":"result","callSeq":5}\n{"broken":true}\n`,
    );
    const m = await readLatestMarker(path);
    expect(m?.callSeq).toBe(5);
    expect(m?.engine).toBe('claude-code');
  });

  it('re-throws non-ENOENT I/O errors (e.g. EISDIR when path is a directory)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ck-dir-'));
    // Passing a directory path causes readFile to throw EISDIR, not ENOENT.
    await expect(readLatestMarker(dir)).rejects.toThrow();
  });

  it('returns null when all lines are invalid markers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ck-'));
    const path = join(dir, 'checkpoints.jsonl');
    await writeFile(path, `{"engine":"pi","phase":"bogus","callSeq":1}\n`);
    expect(await readLatestMarker(path)).toBeNull();
  });

  it('returns the single marker when only one is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ck-'));
    const path = join(dir, 'checkpoints.jsonl');
    await writeFile(
      path,
      `{"engine":"pi","phase":"result","callSeq":3,"toolName":"http.post"}\n`,
    );
    const m = await readLatestMarker(path);
    expect(m?.callSeq).toBe(3);
    expect(m?.toolName).toBe('http.post');
  });
});
