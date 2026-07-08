import { Logger } from '@nestjs/common';
import type { SubagentDetails } from '../database/entities/subagent-details.entity';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';

const moduleLogger = new Logger('mirrorSubagentDetails');

/**
 * Upserts the subagent_details satellite (the authoritative store for subagent
 * result/lineage detail). The execution's terminal STATE is carried separately
 * by execution lifecycle events, so a transient satellite-write failure must not
 * abort an otherwise-successful state transition — it is logged (never silently
 * swallowed) rather than thrown.
 */
export async function mirrorSubagentDetails(
  repo: SubagentDetailsRepository,
  logger: Pick<Logger, 'warn'> | undefined,
  details: Partial<SubagentDetails> & { execution_id: string },
): Promise<void> {
  try {
    await repo.upsert(details);
  } catch (error) {
    const warning = `Failed to upsert subagent_details satellite for execution ${details.execution_id}: ${
      (error as Error).message
    }`;
    if (logger) {
      logger.warn(warning);
    } else {
      moduleLogger.warn(warning);
    }
  }
}
