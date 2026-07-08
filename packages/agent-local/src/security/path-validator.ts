import path from "node:path";

export class PathValidator {
  constructor(private readonly allowedRoots: string[]) {}

  resolvePath(inputPath: string, cwd: string): string {
    const candidate = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(cwd, inputPath);

    this.ensureAllowed(candidate);
    return candidate;
  }

  ensureAllowed(candidatePath: string): void {
    const normalized = path.resolve(candidatePath);
    const isAllowed = this.allowedRoots.some((root) => {
      const normalizedRoot = path.resolve(root);
      return (
        normalized === normalizedRoot ||
        normalized.startsWith(normalizedRoot + path.sep)
      );
    });

    if (!isAllowed) {
      throw new Error(`Path is not within allowed roots: ${normalized}`);
    }
  }
}
