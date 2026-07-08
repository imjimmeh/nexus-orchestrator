import * as fs from 'node:fs/promises';
import { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { DataSource } from 'typeorm';
import type { MemoryDriftCodeCorpus } from './memory-drift-checkers';

/**
 * Schema-index and code-corpus builders for the
 * `MemoryDriftDetectionService` (work item
 * 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * The builders are split out of the service file to keep the
 * service focused on its main flow and to let the milestone-4
 * test file exercise each builder independently. The builders
 * are *intentionally* non-throwing on missing inputs — a
 * transient dependency outage (an unreadable file glob, a
 * `DataSource` without entity metadata) must not crash the
 * detector; the service catches the failure and falls back to
 * `checker_unavailable` for the affected rows.
 */

/**
 * File extensions enumerated by the API-drift code corpus. The
 * detector walks the corpus once per process and caches the
 * matching file list; the regex search runs against the file
 * contents lazily.
 */
const CODE_CORPUS_EXTENSIONS = ['.ts', '.js'] as const;

/**
 * Build the schema index from the TypeORM `DataSource`
 * metadata. The index is a `Map<string, Set<string>>` keyed by
 * `tableName`; each value is the set of `propertyName`s the
 * table exposes in the live database.
 *
 * The build is deterministic and idempotent: a `DataSource`
 * with the same entities always produces the same index. The
 * caller (the detector service) is expected to cache the
 * result at the service instance so the `entityMetadatas` walk
 * happens at most once per process.
 *
 * The function never throws on a partially-populated
 * `DataSource`: a metadata entry with no `tableName` is
 * skipped, a column with no `propertyName` is skipped. The
 * returned index is always non-null; an empty index is the
 * "no schema available" signal the detector falls back to.
 */
export function buildSchemaIndex(
  dataSource: DataSource,
): ReadonlyMap<string, ReadonlySet<string>> {
  const index = new Map<string, Set<string>>();
  const metadatas = dataSource.entityMetadatas;
  for (const metadata of metadatas) {
    const tableName = metadata.tableName;
    if (typeof tableName !== 'string' || tableName.length === 0) {
      continue;
    }
    const columns = new Set<string>();
    for (const column of metadata.columns) {
      if (typeof column.propertyName === 'string') {
        columns.add(column.propertyName);
      }
    }
    index.set(tableName, columns);
  }
  return index;
}

/**
 * Build the API-drift code corpus from a directory tree. The
 * corpus walks `<root>/<all-dirs>/<file>.ts|js` once per process and
 * caches the file list. The `search(pattern)` implementation
 * reads each file lazily on demand — the first invocation
 * pays the walk cost, subsequent invocations reuse the cached
 * file list.
 *
 * The `read(glob)` method returns the absolute paths of every
 * file the walker discovered; today the detector does not use
 * `read` directly, but the method is part of the corpus
 * contract so a future enhancement (e.g. indexed search) can
 * re-use the walker without touching the service.
 */
export async function buildCodeCorpus(
  root: string,
): Promise<MemoryDriftCodeCorpus> {
  const files = await walkSourceTree(root);
  const corpus: MemoryDriftCodeCorpus = {
    read: (): Promise<string[]> => Promise.resolve(files),
    search: async (pattern: RegExp): Promise<number> => {
      let matches = 0;
      for (const filePath of files) {
        let contents: string;
        try {
          contents = await fs.readFile(filePath, 'utf-8');
        } catch {
          // Permission / I/O errors are non-fatal — the
          // detector counts the file as "no match" so a
          // transient read failure cannot inflate the
          // drift count.
          continue;
        }
        if (pattern.test(contents)) {
          matches += 1;
        }
      }
      return matches;
    },
  };
  return corpus;
}

/**
 * Recursively walk a directory tree and return the absolute
 * paths of files whose extension is in
 * {@link CODE_CORPUS_EXTENSIONS}. Symlinks are not followed (the
 * walker inspects `Dirent.isDirectory()` / `Dirent.isFile()`
 * directly); the walker does not loop on cycles because the
 * recursion is purely structural and a cycle would have to
 * involve an `isFile()` entry that is actually a directory —
 * which the walker would reject. The implementation is
 * intentionally minimal: no glob library, no parallelism, no
 * caching beyond the in-process file list.
 */
async function walkSourceTree(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directories are skipped — the detector
      // never throws on a missing / permission-denied path.
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if ((CODE_CORPUS_EXTENSIONS as readonly string[]).includes(ext)) {
        out.push(entryPath);
      }
    }
  }

  await walk(root);
  return out;
}
