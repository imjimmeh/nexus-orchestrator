import { Injectable } from "@nestjs/common";
import type { ModelRate } from "./core-model-pricing-client.service.types";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

@Injectable()
export class CoreModelPricingClientService {
  constructor(private readonly httpClient: KanbanCoreHttpClient) {}

  async fetchActiveModelRates(): Promise<ModelRate[]> {
    const response = await this.httpClient.getJson<{ rates: ModelRate[] }>(
      "/internal/models/rates",
      "fetch active model rates",
    );
    return response.rates;
  }

  async resolveModel(params: {
    agentProfileName: string;
    scopeNodeId?: string;
  }): Promise<{ modelName: string | null; providerName: string | null }> {
    const query = new URLSearchParams();
    query.set("agentProfileName", params.agentProfileName);
    if (params.scopeNodeId) {
      query.set("scopeNodeId", params.scopeNodeId);
    }
    return this.httpClient.getJson<{
      modelName: string | null;
      providerName: string | null;
    }>(
      `/internal/models/resolve?${query.toString()}`,
      "resolve model for agent profile",
    );
  }
}
