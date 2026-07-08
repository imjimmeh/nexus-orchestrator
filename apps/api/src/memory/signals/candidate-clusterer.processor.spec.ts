import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { CandidateClustererProcessor } from './candidate-clusterer.processor';
import type { CandidatePipelineService } from './candidate-pipeline.service';
import type { PipelineRunResult } from './pipeline.types';
import { CANDIDATE_CLUSTERING_JOB_NAME } from './candidate-clusterer.constants';

const CLUSTER_RESULT = {
  clustersFormed: 0,
  candidatesMerged: 0,
  totalPending: 2,
};

const PIPELINE_RESULT: PipelineRunResult = {
  cluster: CLUSTER_RESULT,
  scoring: { scored: 2, totalPending: 2 },
  routed: 2,
};

describe('CandidateClustererProcessor (delegates to CandidatePipelineService)', () => {
  let pipeline: { run: ReturnType<typeof vi.fn> };
  let processor: CandidateClustererProcessor;

  const job = {
    name: CANDIDATE_CLUSTERING_JOB_NAME,
  } as Job<unknown, PipelineRunResult>;

  beforeEach(() => {
    pipeline = { run: vi.fn().mockResolvedValue(PIPELINE_RESULT) };
    processor = new CandidateClustererProcessor(
      pipeline as unknown as CandidatePipelineService,
    );
  });

  it('delegates the cron tick to pipeline.run() and propagates the result', async () => {
    const result = await processor.process(job);

    expect(pipeline.run).toHaveBeenCalledTimes(1);
    expect(result).toEqual(PIPELINE_RESULT);
  });

  it('re-throws when the pipeline fails (cluster re-throw contract)', async () => {
    const failure = new Error('cluster db outage');
    pipeline.run.mockRejectedValueOnce(failure);

    await expect(processor.process(job)).rejects.toBe(failure);
    expect(pipeline.run).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown job names (does not invoke the pipeline)', async () => {
    const result = await processor.process({
      name: 'some-other-job',
    } as Job<unknown, PipelineRunResult>);

    expect(result).toBeNull();
    expect(pipeline.run).not.toHaveBeenCalled();
  });
});
