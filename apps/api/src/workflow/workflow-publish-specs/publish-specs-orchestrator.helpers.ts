import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseSpecFile } from './publish-specs-parser';
import type { ParsedSpec } from './publish-specs-parser.types';

export async function parseAllSpecFiles(params: {
  specDirAbsolute: string;
  specDirectoryRelative: string;
  files: string[];
  warnings: string[];
}): Promise<ParsedSpec[]> {
  const { parsedSpecs } = await parseAllSpecFilesWithDiagnostics(params);
  return parsedSpecs;
}

export async function parseAllSpecFilesWithDiagnostics(params: {
  specDirAbsolute: string;
  specDirectoryRelative: string;
  files: string[];
  warnings: string[];
}): Promise<{
  parsedSpecs: ParsedSpec[];
  fileDiagnostics: Array<{
    file: string;
    ok: boolean;
    warning?: string;
    resource_id?: string;
    title?: string;
  }>;
}> {
  const parsedSpecs: ParsedSpec[] = [];
  const fileDiagnostics: Array<{
    file: string;
    ok: boolean;
    warning?: string;
    resource_id?: string;
    title?: string;
  }> = [];

  for (const fileName of params.files) {
    const filePath = path.join(params.specDirAbsolute, fileName);
    const sourcePath = toRepoRelativeSpecPath(
      params.specDirectoryRelative,
      fileName,
    );
    const fileWarnings: string[] = [];
    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = parseSpecFile(
        fileName,
        content,
        (message) => {
          params.warnings.push(message);
          fileWarnings.push(message);
        },
        sourcePath,
      );
      if (parsed) {
        parsedSpecs.push(parsed);
        fileDiagnostics.push({
          file: fileName,
          ok: true,
          resource_id: parsed.sourceId,
          title: parsed.title,
        });
      } else {
        const warning = `Skipped ${fileName}: missing or invalid frontmatter`;
        params.warnings.push(warning);
        fileDiagnostics.push({
          file: fileName,
          ok: false,
          warning: fileWarnings.length > 0 ? fileWarnings.join('; ') : warning,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const warning = `Failed to read ${fileName}: ${msg}`;
      params.warnings.push(warning);
      fileDiagnostics.push({
        file: fileName,
        ok: false,
        warning,
      });
    }
  }

  return { parsedSpecs, fileDiagnostics };
}

function toRepoRelativeSpecPath(
  specDirectoryRelative: string,
  fileName: string,
): string {
  const normalizedDirectory = specDirectoryRelative
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  const normalizedFile = fileName.replaceAll('\\', '/').replace(/^\.\//, '');

  return `${normalizedDirectory}/${normalizedFile}`;
}
