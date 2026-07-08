import { Injectable } from '@nestjs/common';

@Injectable()
export class RepositoryLockService {
  private readonly repoLocks = new Map<string, Promise<unknown>>();

  async runRepoExclusive<T>(
    repoPath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.repoLocks.get(repoPath) || Promise.resolve();

    const next = previous.catch(() => undefined).then(() => task());

    this.repoLocks.set(
      repoPath,
      next.then(() => undefined).catch(() => undefined),
    );

    return next;
  }
}
