import { BadRequestException } from '@nestjs/common';
import { requireNonEmptyString as coreRequireNonEmptyString } from '@nexus/core';

/**
 * Preserve the HTTP-layer contract (`BadRequestException` → HTTP 400) while
 * delegating the actual validation to the shared core helper.
 */
export function requireNonEmptyString(value: unknown, field: string): string {
  try {
    return coreRequireNonEmptyString(value, field);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : `${field} is required`,
    );
  }
}

export function resolveCriticalToolNames(job: {
  output_contract?: unknown;
}): Set<string> {
  const toolNames = new Set<string>();

  const contract = job.output_contract as { required?: unknown } | undefined;
  if (Array.isArray(contract?.required) && contract.required.length > 0) {
    toolNames.add('set_job_output');
  }

  return toolNames;
}
