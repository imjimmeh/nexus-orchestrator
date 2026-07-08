import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogLevel } from '@nestjs/common';
import type { RequestContext } from './request-context.service';

const API_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

type ApiLogLevel = (typeof API_LOG_LEVELS)[number];

type LogLevelEnvironment = {
  LOG_LEVEL?: string;
};

/**
 * Winston format that injects request context (requestId, userId, workflowRunId)
 * from AsyncLocalStorage into every log entry.
 *
 * We read directly from AsyncLocalStorage rather than importing the service
 * because the logger is created before the NestJS DI container is initialised.
 */
const requestContextFormat = winston.format((info) => {
  // AsyncLocalStorage stores are accessible from any async context —
  // iterate active resources to find the RequestContext store.
  // The RequestContextService uses a module-scoped AsyncLocalStorage instance,
  // so we expose a static reference for the logger to read.
  const ctx = RequestContextLogger.getContext();
  if (ctx) {
    info['requestId'] = ctx.requestId;
    if (ctx.userId) info['userId'] = ctx.userId;
    if (ctx.workflowRunId) info['workflowRunId'] = ctx.workflowRunId;
  }
  return info;
});

/**
 * Bridge between RequestContextService (DI-managed) and the Winston logger
 * (created before DI). Call `init(storage)` once the service is available.
 */
let _storage: AsyncLocalStorage<RequestContext> | undefined;

export const RequestContextLogger = {
  init(storage: AsyncLocalStorage<RequestContext>): void {
    _storage = storage;
  },

  getContext(): RequestContext | undefined {
    return _storage?.getStore();
  },
};

export function getApiLogLevel(env: LogLevelEnvironment): ApiLogLevel {
  const logLevel = env.LOG_LEVEL?.toLowerCase();
  return isApiLogLevel(logLevel) ? logLevel : 'info';
}

export function getNestLoggerLevels(apiLogLevel: ApiLogLevel): LogLevel[] {
  const levels: LogLevel[] = ['fatal', 'error'];

  if (apiLogLevel === 'error') {
    return levels;
  }

  levels.push('warn');

  if (apiLogLevel === 'warn') {
    return levels;
  }

  levels.push('log');

  if (apiLogLevel === 'info') {
    return levels;
  }

  levels.push('debug');
  return levels;
}

function isApiLogLevel(value: string | undefined): value is ApiLogLevel {
  return API_LOG_LEVELS.some((level) => level === value);
}

const apiLogLevel = getApiLogLevel(process.env);

export const loggerConfig = {
  transports: [
    new winston.transports.Console({
      level: apiLogLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        requestContextFormat(),
        nestWinstonModuleUtilities.format.nestLike('NexusAPI', {
          colors: true,
          prettyPrint: true,
        }),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        requestContextFormat(),
        winston.format.json(),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      level: apiLogLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        requestContextFormat(),
        winston.format.json(),
      ),
    }),
  ],
};
