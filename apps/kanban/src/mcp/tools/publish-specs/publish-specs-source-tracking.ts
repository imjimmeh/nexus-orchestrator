import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { SourceSpecTrackingResult } from "./publish-specs-source-tracking.types";

const execFileAsync = promisify(execFile);

type SourceSpec = {
  sourceId: string;
  sourcePath: string;
};

export async function validateSourceSpecTracking(input: {
  allowUntrackedSpecs?: boolean;
  specs: SourceSpec[];
  files: string[];
  specDirectory: string;
  specRoot: string;
}): Promise<SourceSpecTrackingResult> {
  if (input.allowUntrackedSpecs === true || input.files.length === 0) {
    return { errors: [], erroredSourceIds: new Set() };
  }

  const repoRoot = await resolveGitRoot(input.specRoot);
  if (!repoRoot) {
    return { errors: [], erroredSourceIds: new Set() };
  }

  const relativePaths = input.files.map((fileName) =>
    toGitPath(path.relative(repoRoot, path.join(input.specRoot, fileName))),
  );
  const statusLines = await gitLines(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...relativePaths,
  ]);
  const untrackedPaths = new Set(
    statusLines
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3).trim()),
  );
  if (untrackedPaths.size === 0) {
    return { errors: [], erroredSourceIds: new Set() };
  }

  const specsBySourcePath = new Map(
    input.specs.map((spec) => [spec.sourcePath, spec] as const),
  );
  const sourcePathPrefix = input.specDirectory
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
  const errors: SourceSpecTrackingResult["errors"] = [];
  const erroredSourceIds = new Set<string>();

  for (const fileName of input.files) {
    const relativePath = toGitPath(
      path.relative(repoRoot, path.join(input.specRoot, fileName)),
    );
    if (!untrackedPaths.has(relativePath)) continue;

    const sourcePath = `${sourcePathPrefix}/${fileName}`;
    const spec = specsBySourcePath.get(sourcePath);
    if (spec) {
      erroredSourceIds.add(spec.sourceId);
    }
    errors.push({
      source_path: sourcePath,
      message:
        "untracked_source_spec: canonical publish_specs source files must be tracked before import, or allow_untracked_specs must be set explicitly.",
    });
  }

  return { errors, erroredSourceIds };
}

async function resolveGitRoot(specRoot: string): Promise<string | undefined> {
  try {
    const lines = await gitLines(specRoot, ["rev-parse", "--show-toplevel"]);
    return lines[0] ? path.normalize(lines[0]) : undefined;
  } catch {
    return undefined;
  }
}

async function gitLines(cwd: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return args.includes("-z")
    ? stdout.split("\0").filter((line) => line.length > 0)
    : stdout.split(/\r?\n/).filter((line) => line.length > 0);
}

function toGitPath(value: string): string {
  return value.replaceAll("\\", "/");
}
