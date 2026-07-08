import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ListFilesResult } from './git-file.ops.types';

export async function listRepoFiles(
  repoPath: string,
  directory: string,
  pattern?: string,
): Promise<ListFilesResult> {
  const fullPath = path.join(repoPath, directory);
  const files: Array<{ path: string; size: number }> = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        if (!pattern || entry.name.endsWith(pattern)) {
          const stat = await fs.stat(entryPath);
          files.push({
            path: path.relative(repoPath, entryPath),
            size: stat.size,
          });
        }
      }
    }
  }

  try {
    await walk(fullPath);
  } catch {
    return { files: [] };
  }

  return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

export async function readRepoFile(
  repoPath: string,
  filePath: string,
): Promise<string> {
  const fullPath = path.join(repoPath, filePath);
  const resolved = path.resolve(fullPath);
  const repoResolved = path.resolve(repoPath);
  if (!resolved.startsWith(repoResolved)) {
    throw new Error('Path traversal denied');
  }
  return fs.readFile(fullPath, 'utf-8');
}

export async function writeRepoFile(
  repoPath: string,
  filePath: string,
  content: string,
): Promise<string> {
  const fullPath = path.join(repoPath, filePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

export async function deleteRepoFile(
  repoPath: string,
  filePath: string,
): Promise<string> {
  const fullPath = path.join(repoPath, filePath);
  const resolved = path.resolve(fullPath);
  const repoResolved = path.resolve(repoPath);
  if (!resolved.startsWith(repoResolved)) {
    throw new Error('Path traversal denied');
  }
  await fs.unlink(fullPath);
  return fullPath;
}
