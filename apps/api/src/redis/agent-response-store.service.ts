import { Injectable, Logger, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.constants';
import { Redis } from 'ioredis';

const RESPONSE_KEY_PREFIX = 'agent-response';
const STEP_COMPLETE_KEY_PREFIX = 'step-complete';
const DEFAULT_TTL_SECONDS = 600; // 10 minutes
export const AGENT_RESPONSE_ERROR_PREFIX = '__AGENT_ERROR__:';
export const AGENT_RESPONSE_EMPTY_SENTINEL = '__AGENT_EMPTY__';

@Injectable()
export class AgentResponseStoreService {
  private readonly logger = new Logger(AgentResponseStoreService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Store the agent's final response text so the job-execution consumer
   * can include it in the job output (making it available to downstream jobs).
   */
  async store(
    workflowRunId: string,
    jobId: string,
    response: string,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const key = this.buildKey(workflowRunId, jobId);
    await this.redis.set(key, response, 'EX', ttlSeconds);
    this.logger.debug(
      `Stored agent response for ${key} (${response.length} chars)`,
    );
  }

  /**
   * Retrieve and delete agent response (one-time read).
   */
  async pop(workflowRunId: string, jobId: string): Promise<string | null> {
    const key = this.buildKey(workflowRunId, jobId);
    return this.redis.getdel(key);
  }

  private buildKey(workflowRunId: string, jobId: string): string {
    return `${RESPONSE_KEY_PREFIX}:${workflowRunId}:${jobId}`;
  }

  /**
   * Store an explicit step-complete signal from the agent.
   * Used for interactive multi-step jobs where the agent signals
   * it has finished its work (vs. just emitting a planning message).
   */
  async storeStepComplete(
    workflowRunId: string,
    jobId: string,
    response: string,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const key = this.buildStepCompleteKey(workflowRunId, jobId);
    await this.redis.set(key, response, 'EX', ttlSeconds);
    this.logger.debug(
      `Stored step-complete for ${key} (${response.length} chars)`,
    );
  }

  /**
   * Retrieve and delete a step-complete signal (one-time read).
   */
  async popStepComplete(
    workflowRunId: string,
    jobId: string,
  ): Promise<string | null> {
    const key = this.buildStepCompleteKey(workflowRunId, jobId);
    return this.redis.getdel(key);
  }

  private buildStepCompleteKey(workflowRunId: string, jobId: string): string {
    return `${STEP_COMPLETE_KEY_PREFIX}:${workflowRunId}:${jobId}`;
  }
}
