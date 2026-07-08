import type { CoreClient } from "../interfaces/service-clients.types";
import type {
  CoreWorkflowEventTypeV1,
  CoreWorkflowRunEventPayloadV1,
  EventEnvelopeV1,
} from "../schemas/events/event-envelope.schema";
import type {
  WorkflowRunAcceptedV1,
  WorkflowRunScopeCancelRequestV1,
  WorkflowRunScopeCancelResultV1,
  WorkflowRunControlRequestV1,
  WorkflowRunControlResultV1,
  WorkflowRunRequestV1,
  WorkflowRunStatusV1,
} from "../schemas/workflow-run/workflow-run-contracts.schema";
import type { ServiceClientHttpOptions } from "./http-client.types";
import { sendJsonRequest } from "./http-request";

type ApiSuccessEnvelope<T> = {
  success: boolean;
  data: T;
};

export class CoreHttpClient implements CoreClient {
  constructor(private readonly options: ServiceClientHttpOptions) {}

  async requestWorkflowRun(
    request: WorkflowRunRequestV1,
  ): Promise<WorkflowRunAcceptedV1> {
    const response = await sendJsonRequest<
      WorkflowRunAcceptedV1 | ApiSuccessEnvelope<WorkflowRunAcceptedV1>
    >(this.options, {
      path: "/internal/core/workflow-runs",
      method: "POST",
      headers: this.buildTraceHeaders(request.metadata),
      body: request,
    });

    return this.unwrapApiResponse(response);
  }

  async getWorkflowRunStatus(
    runId: string,
    correlationId: string,
  ): Promise<WorkflowRunStatusV1> {
    const response = await sendJsonRequest<
      WorkflowRunStatusV1 | ApiSuccessEnvelope<WorkflowRunStatusV1>
    >(this.options, {
      path: `/internal/core/workflow-runs/${encodeURIComponent(runId)}`,
      method: "GET",
      headers: {
        "x-correlation-id": correlationId,
      },
    });

    return this.unwrapApiResponse(response);
  }

  async controlWorkflowRun(
    request: WorkflowRunControlRequestV1,
  ): Promise<WorkflowRunControlResultV1> {
    const response = await sendJsonRequest<
      | WorkflowRunControlResultV1
      | ApiSuccessEnvelope<WorkflowRunControlResultV1>
    >(this.options, {
      path: `/internal/core/workflow-runs/${encodeURIComponent(request.run_id)}/control`,
      method: "POST",
      headers: this.buildTraceHeaders(request.metadata),
      body: request,
    });

    return this.unwrapApiResponse(response);
  }

  async cancelWorkflowRunsByScope(
    scopeId: string,
    request: WorkflowRunScopeCancelRequestV1,
  ): Promise<WorkflowRunScopeCancelResultV1> {
    const response = await sendJsonRequest<
      | WorkflowRunScopeCancelResultV1
      | ApiSuccessEnvelope<WorkflowRunScopeCancelResultV1>
    >(this.options, {
      path: `/internal/core/workflow-runs/scope/${encodeURIComponent(scopeId)}/cancel`,
      method: "POST",
      headers: this.buildTraceHeaders(request.metadata),
      body: request,
    });

    return this.unwrapApiResponse(response);
  }

  async publishCoreEvent(
    event: EventEnvelopeV1<
      CoreWorkflowEventTypeV1,
      CoreWorkflowRunEventPayloadV1
    >,
  ): Promise<void> {
    await sendJsonRequest<unknown>(this.options, {
      path: "/internal/core/events",
      method: "POST",
      body: event,
    });
  }

  private unwrapApiResponse<T>(response: T | ApiSuccessEnvelope<T>): T {
    if (this.isApiSuccessEnvelope(response)) {
      return response.data;
    }

    return response;
  }

  private isApiSuccessEnvelope<T>(
    value: T | ApiSuccessEnvelope<T>,
  ): value is ApiSuccessEnvelope<T> {
    if (value === null || typeof value !== "object") {
      return false;
    }

    return "data" in value;
  }

  private buildTraceHeaders(metadata: {
    correlation_id: string;
    causation_id?: string | null;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      "x-correlation-id": metadata.correlation_id,
    };

    const causationId = metadata.causation_id?.trim();
    if (causationId) {
      headers["x-causation-id"] = causationId;
    }

    return headers;
  }
}
