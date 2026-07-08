import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { RequestContextService } from './request-context.service';

interface ReplyArgs {
  body: unknown;
  status: number;
}

function createHostWithReply(): {
  host: ArgumentsHost;
  capture: ReplyArgs;
  reply: ReturnType<typeof vi.fn>;
} {
  const capture: ReplyArgs = { body: undefined, status: 0 };
  const reply = vi.fn((_res: unknown, body: unknown, status: number) => {
    capture.body = body;
    capture.status = status;
  });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({}),
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  return { host, capture, reply };
}

function createFilter(reply: ReturnType<typeof vi.fn>): AllExceptionsFilter {
  const httpAdapterHost = {
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost;
  const requestContext = {
    getRequestId: () => 'req-123',
  } as unknown as RequestContextService;
  return new AllExceptionsFilter(httpAdapterHost, requestContext);
}

describe('AllExceptionsFilter', () => {
  it('preserves HttpException response shape', () => {
    const { host, capture, reply } = createHostWithReply();
    const filter = createFilter(reply);

    filter.catch(new BadRequestException('bad input'), host);

    expect(capture.status).toBe(400);
    const body = capture.body as { error: { code: string; message: string } };
    expect(body.error.message).toBe('bad input');
    expect(body.error.code).toBe('BadRequestException');
  });

  it('exposes the real Error message when a non-HttpException is thrown', () => {
    const { host, capture, reply } = createHostWithReply();
    const filter = createFilter(reply);

    filter.catch(
      new Error('Dehydrate acknowledgement timed out for container abc'),
      host,
    );

    expect(capture.status).toBe(500);
    const body = capture.body as {
      error: { code: string; message: string; details: unknown };
    };
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe(
      'Dehydrate acknowledgement timed out for container abc',
    );
    expect(body.error.details).toMatchObject({ name: 'Error' });
  });

  it('uses a custom Error subclass name as part of details', () => {
    class TimeoutError extends Error {
      override name = 'TimeoutError';
    }
    const { host, capture, reply } = createHostWithReply();
    const filter = createFilter(reply);

    filter.catch(new TimeoutError('took too long'), host);

    const body = capture.body as {
      error: { message: string; details: { name: string } };
    };
    expect(body.error.message).toBe('took too long');
    expect(body.error.details.name).toBe('TimeoutError');
  });

  it('falls back to the generic message when the thrown value is not an Error', () => {
    const { host, capture, reply } = createHostWithReply();
    const filter = createFilter(reply);

    filter.catch('boom', host);

    const body = capture.body as { error: { message: string } };
    expect(body.error.message).toBe('Internal server error');
  });

  it('translates Postgres invalid_text_representation (22P02) into a 400 with a friendly message', () => {
    class QueryFailedError extends Error {
      override name = 'QueryFailedError';
      code = '22P02';
    }
    const { host, capture, reply } = createHostWithReply();
    const filter = createFilter(reply);

    filter.catch(
      new QueryFailedError(
        'invalid input syntax for type uuid: "not-a-uuid-value"',
      ),
      host,
    );

    expect(capture.status).toBe(400);
    const body = capture.body as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('BadRequestException');
    expect(body.error.message.toLowerCase()).toContain('invalid');
    expect(body.error.message).toContain('not-a-uuid-value');
  });
});
