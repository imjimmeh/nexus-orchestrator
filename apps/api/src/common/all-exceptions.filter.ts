import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { RequestContextService } from './request-context.service';

const POSTGRES_INVALID_TEXT_REPRESENTATION = '22P02';

function isPostgresInvalidTextRepresentation(
  exception: unknown,
): exception is Error & { code: string } {
  if (!(exception instanceof Error)) {
    return false;
  }
  const candidate = exception as Error & { code?: unknown };
  return (
    typeof candidate.code === 'string' &&
    candidate.code === POSTGRES_INVALID_TEXT_REPRESENTATION
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Optional()
    @Inject(RequestContextService)
    private readonly requestContext?: RequestContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const normalizedException = this.normalizeException(exception);
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus = this.resolveHttpStatus(normalizedException);
    const message = this.resolveMessage(normalizedException);

    const requestId = this.requestContext?.getRequestId();

    const responseBody = this.buildErrorResponse(
      normalizedException,
      message,
      requestId,
    );
    this.logIfServerError(httpStatus, normalizedException, requestId);

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }

  private normalizeException(exception: unknown): unknown {
    if (isPostgresInvalidTextRepresentation(exception)) {
      return new BadRequestException(`Invalid argument: ${exception.message}`);
    }
    return exception;
  }

  private resolveHttpStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(exception: unknown): string | string[] {
    if (exception instanceof HttpException) {
      const response = exception.getResponse() as
        | string
        | { message?: string | string[] };

      return typeof response === 'object'
        ? response.message || exception.message
        : response;
    }

    if (exception instanceof Error && exception.message) {
      return exception.message;
    }

    return 'Internal server error';
  }

  private resolveDetails(exception: unknown): unknown {
    if (exception instanceof HttpException) {
      return exception.getResponse();
    }

    if (exception instanceof Error) {
      return { name: exception.name };
    }

    return {};
  }

  private buildErrorResponse(
    exception: unknown,
    message: string | string[],
    requestId?: string,
  ): {
    success: false;
    error: {
      code: string;
      message: string;
      details: unknown;
      timestamp: string;
      requestId?: string;
    };
  } {
    const response = {
      success: false as const,
      error: {
        code:
          exception instanceof HttpException
            ? exception.name
            : 'INTERNAL_SERVER_ERROR',
        message: Array.isArray(message) ? message[0] : message,
        details: this.resolveDetails(exception),
        timestamp: new Date().toISOString(),
      },
    };

    if (!requestId) {
      return response;
    }

    return {
      ...response,
      error: {
        ...response.error,
        requestId,
      },
    };
  }

  private logIfServerError(
    httpStatus: number,
    exception: unknown,
    requestId?: string,
  ): void {
    if (httpStatus < 500) {
      return;
    }

    this.logger.error(
      `Exception [${requestId ?? 'no-request-id'}]: ${String(exception)}`,
      (exception as Error).stack,
    );
  }
}
