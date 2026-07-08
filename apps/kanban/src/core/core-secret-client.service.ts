import type { CoreSecretClient } from "./core-client.types";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

export class CoreSecretClientService implements CoreSecretClient {
  constructor(private readonly httpClient: KanbanCoreHttpClient) {}

  async retrieveSecret(secretId: string): Promise<string> {
    const data = await this.httpClient.postJson<{ secretValue: string }>(
      "/internal/secrets/retrieve",
      { secretId },
      "secret retrieval",
    );
    return data.secretValue;
  }
}
