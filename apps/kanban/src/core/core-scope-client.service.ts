import { Inject, Injectable } from "@nestjs/common";
import type { ServiceClientHttpOptions } from "@nexus/core";
import type {
  CoreScopeClient,
  EnsureProjectNodeInput,
  ScopeNodeRecord,
} from "./core-client.types";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

const DEFAULT_CORE_BASE_URL = "http://localhost:3010/api";

@Injectable()
export class CoreScopeClientService implements CoreScopeClient {
  private readonly httpClient: KanbanCoreHttpClient;

  constructor(
    @Inject(KanbanCoreAuthTokenProvider)
    private readonly authTokenProvider: KanbanCoreAuthTokenProvider,
  ) {
    const coreBaseUrl =
      this.readOptionalEnv("KANBAN_CORE_BASE_URL") ?? DEFAULT_CORE_BASE_URL;
    const httpOptions = this.resolveHttpOptions(coreBaseUrl);
    this.httpClient = new KanbanCoreHttpClient(coreBaseUrl, httpOptions);
  }

  async ensureProjectNode(
    input: EnsureProjectNodeInput,
  ): Promise<ScopeNodeRecord> {
    return this.httpClient.postJson<ScopeNodeRecord>(
      "/scopes/ensure",
      input,
      "ensure scope node",
    );
  }

  private resolveHttpOptions(baseUrl: string): ServiceClientHttpOptions {
    return {
      baseUrl,
      authorizationHeaderResolver: () =>
        this.authTokenProvider.resolveAuthorizationHeader(),
    };
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
