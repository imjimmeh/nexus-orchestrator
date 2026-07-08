import { Inject, Injectable } from "@nestjs/common";
import type {
  ResolvedVariable,
  ServiceClientHttpOptions,
  UpsertScopedVariableRequest,
} from "@nexus/core";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";
import type { CoreVariablesClient } from "./core-variables-client.types";

const DEFAULT_CORE_BASE_URL = "http://localhost:3010/api";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable()
export class CoreVariablesClientService implements CoreVariablesClient {
  private readonly httpClient: KanbanCoreHttpClient;

  constructor(
    @Inject(KanbanCoreAuthTokenProvider)
    private readonly authTokenProvider: KanbanCoreAuthTokenProvider,
  ) {
    const coreBaseUrl =
      this.readOptionalEnv("KANBAN_CORE_BASE_URL") ?? DEFAULT_CORE_BASE_URL;
    this.httpClient = new KanbanCoreHttpClient(
      coreBaseUrl,
      this.resolveHttpOptions(coreBaseUrl),
    );
  }

  async getEffective(scopeId: string): Promise<ResolvedVariable[]> {
    const response = await this.httpClient.getJson<
      ApiEnvelope<ResolvedVariable[]>
    >(
      `/variables/effective?scopeId=${encodeURIComponent(scopeId)}`,
      "resolve effective variables",
    );
    if (!response.success) {
      throw new Error(`API variable store error: ${JSON.stringify(response)}`);
    }
    return response.data;
  }

  async upsert(input: UpsertScopedVariableRequest): Promise<void> {
    const response = await this.httpClient.postJson<ApiEnvelope<unknown>>(
      "/variables",
      input,
      "upsert variable",
    );
    if (!response.success) {
      throw new Error(`API variable store error: ${JSON.stringify(response)}`);
    }
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
