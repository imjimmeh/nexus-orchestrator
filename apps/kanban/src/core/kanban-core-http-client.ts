import type { CommitPathsResult, ServiceClientHttpOptions } from "@nexus/core";
import type { RepositoryFileContent } from "@nexus/core";

export class KanbanCoreHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly httpOptions: ServiceClientHttpOptions,
  ) {}

  async postJson<TResponse>(
    path: string,
    body: unknown,
    operationName: string,
  ): Promise<TResponse> {
    const authorization =
      this.httpOptions.authorizationHeaderResolver === undefined
        ? null
        : await this.httpOptions.authorizationHeaderResolver();
    const response = await fetch(
      `${this.trimTrailingSlash(this.baseUrl)}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.httpOptions.headers,
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} for ${operationName}`,
      );
    }

    return (await response.json()) as TResponse;
  }

  async getJson<TResponse>(
    path: string,
    operationName: string,
  ): Promise<TResponse> {
    const authorization =
      this.httpOptions.authorizationHeaderResolver === undefined
        ? null
        : await this.httpOptions.authorizationHeaderResolver();
    const response = await fetch(
      `${this.trimTrailingSlash(this.baseUrl)}${path}`,
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          ...this.httpOptions.headers,
          ...(authorization ? { authorization } : {}),
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} for ${operationName}`,
      );
    }

    return (await response.json()) as TResponse;
  }

  async commitPaths(body: {
    repoPath: string;
    paths: string[];
    message: string;
    push?: boolean;
  }): Promise<CommitPathsResult> {
    return this.postJson<CommitPathsResult>(
      "/git/commit-paths",
      body,
      "commit-paths",
    );
  }

  async listRepoFiles(params: {
    repoPath: string;
    directory: string;
    pattern?: string;
  }) {
    return this.postJson<{ files: Array<{ path: string; size: number }> }>(
      "/git/files/list",
      params,
      "list-files",
    );
  }

  async readRepoFile(params: { repoPath: string; filePath: string }) {
    return this.postJson<{ content: string }>(
      "/git/files/read",
      params,
      "read-file",
    );
  }

  async writeRepoFile(params: {
    repoPath: string;
    filePath: string;
    content: string;
    message: string;
    push?: boolean;
  }) {
    return this.postJson<CommitPathsResult>(
      "/git/files/write",
      params,
      "write-file",
    );
  }

  async deleteRepoFile(params: {
    repoPath: string;
    filePath: string;
    message: string;
    push?: boolean;
  }) {
    return this.postJson<CommitPathsResult>(
      "/git/files/delete",
      params,
      "delete-file",
    );
  }

  async listRepositoryBranches(params: { repoPath: string }) {
    return this.postJson<{ branches: string[] }>(
      "/git/branches/list",
      params,
      "list-repository-branches",
    );
  }

  async listRepositoryTrackedFiles(params: { repoPath: string }) {
    return this.postJson<{ files: string[] }>(
      "/git/tracked-files/list",
      params,
      "list-repository-tracked-files",
    );
  }

  async showRepositoryFile(params: {
    repoPath: string;
    filePath: string;
    ref?: string;
  }) {
    return this.postJson<RepositoryFileContent>(
      "/git/files/show",
      params,
      "show-repository-file",
    );
  }

  private trimTrailingSlash(value: string): string {
    return value.endsWith("/") ? value.slice(0, -1) : value;
  }
}
