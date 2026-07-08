import { Injectable, Logger, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.constants';
import { Redis } from 'ioredis';
import type { HarnessRuntimeConfig } from '@nexus/core';

const CONFIG_KEY_PREFIX = 'runner-config';
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class RunnerConfigStoreService {
  private readonly logger = new Logger(RunnerConfigStoreService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Store a runner config payload in Redis with a TTL.
   * Keyed by workflowRunId:jobId so the gateway can look it up
   * when the agent connects and presents its JWT.
   */
  async store(
    workflowRunId: string,
    jobId: string,
    payload: HarnessRuntimeConfig,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const key = this.buildKey(workflowRunId, jobId);
    await this.redis.set(key, JSON.stringify(payload), 'EX', ttlSeconds);
    this.logger.debug(`Stored runner config for ${key} (TTL ${ttlSeconds}s)`);
  }

  /**
   * Retrieve and delete (pop) a runner config payload.
   * Uses GETDEL so the secret is only ever read once.
   */
  async pop(
    workflowRunId: string,
    jobId: string,
  ): Promise<HarnessRuntimeConfig | null> {
    const key = this.buildKey(workflowRunId, jobId);
    const raw = await this.redis.getdel(key);
    if (!raw) return null;
    return JSON.parse(raw) as HarnessRuntimeConfig;
  }

  /**
   * Retrieve a runner config payload without removing it.
   */
  async get(
    workflowRunId: string,
    jobId: string,
  ): Promise<HarnessRuntimeConfig | null> {
    const key = this.buildKey(workflowRunId, jobId);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as HarnessRuntimeConfig;
  }

  /**
   * Explicitly remove a runner config payload.
   */
  async delete(workflowRunId: string, jobId: string): Promise<void> {
    const key = this.buildKey(workflowRunId, jobId);
    await this.redis.del(key);
  }

  private buildKey(workflowRunId: string, jobId: string): string {
    return `${CONFIG_KEY_PREFIX}:${workflowRunId}:${jobId}`;
  }
}
