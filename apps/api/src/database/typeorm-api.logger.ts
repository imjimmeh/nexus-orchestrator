import { Logger } from '@nestjs/common';

type TypeOrmLogLevel = 'log' | 'info' | 'warn';

export class TypeOrmApiLogger {
  private readonly logger = new Logger(TypeOrmApiLogger.name);

  logQuery(query: string, parameters?: unknown[]): void {
    this.logger.debug(formatQueryMessage('query', query, parameters));
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
  ): void {
    this.logger.error(
      `${formatQueryMessage('query failed', query, parameters)} -- error: ${formatError(error)}`,
    );
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]): void {
    this.logger.warn(
      `${formatQueryMessage('slow query', query, parameters)} -- execution time: ${time}ms`,
    );
  }

  logSchemaBuild(message: string): void {
    this.logger.log(`schema build: ${message}`);
  }

  logMigration(message: string): void {
    this.logger.log(`migration: ${message}`);
  }

  log(level: TypeOrmLogLevel, message: unknown): void {
    if (level === 'warn') {
      this.logger.warn(String(message));
      return;
    }

    this.logger.log(String(message));
  }
}

function formatQueryMessage(
  prefix: string,
  query: string,
  parameters?: unknown[],
): string {
  const parametersMessage = formatParameters(parameters);
  return parametersMessage
    ? `${prefix}: ${query} -- parameters: ${parametersMessage}`
    : `${prefix}: ${query}`;
}

function formatParameters(parameters?: unknown[]): string | undefined {
  if (!parameters || parameters.length === 0) {
    return undefined;
  }

  return JSON.stringify(parameters);
}

function formatError(error: string | Error): string {
  return error instanceof Error ? error.message : error;
}
