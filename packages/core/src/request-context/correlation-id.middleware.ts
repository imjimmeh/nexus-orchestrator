import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { BaseRequestContextService } from "./base-request-context.service";
import type {
  CorrelationIdNextFunction,
  CorrelationIdRequest,
  CorrelationIdResponse,
} from "./request-context.types";

export const REQUEST_ID_HEADER = "X-Request-ID";
export const CORRELATION_ID_HEADER = "X-Correlation-ID";
export const CAUSATION_ID_HEADER = "X-Causation-ID";

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware<
  CorrelationIdRequest,
  CorrelationIdResponse
> {
  constructor(private readonly contextService: BaseRequestContextService) {}

  use(
    req: CorrelationIdRequest,
    res: CorrelationIdResponse,
    next: CorrelationIdNextFunction,
  ): void {
    const requestId =
      this.readHeader(req, CORRELATION_ID_HEADER) ??
      this.readHeader(req, REQUEST_ID_HEADER) ??
      randomUUID();
    const causationId = this.readHeader(req, CAUSATION_ID_HEADER);

    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(CORRELATION_ID_HEADER, requestId);
    if (causationId) {
      res.setHeader(CAUSATION_ID_HEADER, causationId);
    }

    this.contextService.run({ requestId, causationId }, () => {
      next();
    });
  }

  private readHeader(
    req: CorrelationIdRequest,
    headerName: string,
  ): string | undefined {
    const value = req.headers[headerName.toLowerCase()];
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
