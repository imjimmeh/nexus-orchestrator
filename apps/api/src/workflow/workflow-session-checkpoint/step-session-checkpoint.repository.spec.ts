import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { StepSessionCheckpointEntity } from './step-session-checkpoint.entity.js';
import type { RecordCheckpointInput } from './step-session-checkpoint.types.js';
import { StepSessionCheckpointRepository } from './step-session-checkpoint.repository.js';

type RepositorySubset = Pick<
  Repository<StepSessionCheckpointEntity>,
  'create' | 'save' | 'findOne' | 'count' | 'insert'
>;

const buildEntity = (
  overrides: Partial<StepSessionCheckpointEntity> = {},
): StepSessionCheckpointEntity => ({
  id: 'ckpt-1',
  execution_id: 'e1',
  workflow_run_id: 'r1',
  step_id: 's1',
  engine: 'pi',
  phase: 'result',
  call_seq: 1,
  session_ref: null,
  resume_node_id: null,
  transcript_locator: null,
  tool_name: null,
  idempotency_key: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const baseInput = (): RecordCheckpointInput => ({
  executionId: 'e1',
  workflowRunId: 'r1',
  stepId: 's1',
  engine: 'pi',
  phase: 'result',
  callSeq: 1,
});

describe('StepSessionCheckpointRepository', () => {
  let typeormRepo: RepositorySubset;
  let repo: StepSessionCheckpointRepository;

  beforeEach(() => {
    typeormRepo = {
      create: vi.fn((data) => data as StepSessionCheckpointEntity),
      save: vi.fn(async (entity) => entity as StepSessionCheckpointEntity),
      findOne: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    repo = new StepSessionCheckpointRepository(
      typeormRepo as Repository<StepSessionCheckpointEntity>,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('record', () => {
    it('persists a checkpoint with all required fields', async () => {
      await repo.record(baseInput());

      expect(typeormRepo.create).toHaveBeenCalledWith({
        execution_id: 'e1',
        workflow_run_id: 'r1',
        step_id: 's1',
        engine: 'pi',
        phase: 'result',
        call_seq: 1,
        session_ref: null,
        resume_node_id: null,
        transcript_locator: null,
        tool_name: null,
        idempotency_key: null,
      });
      expect(typeormRepo.save).toHaveBeenCalledTimes(1);
    });

    it('maps optional fields when provided', async () => {
      const input: RecordCheckpointInput = {
        ...baseInput(),
        phase: 'intent',
        callSeq: 3,
        sessionRef: { kind: 'pi', treeId: 't1' },
        resumeNodeId: 'node-1',
        transcriptLocator: 'gs://bucket/path',
        toolName: 'http.post',
        idempotencyKey: 'sha256-abc',
      };

      await repo.record(input);

      expect(typeormRepo.create).toHaveBeenCalledWith({
        execution_id: 'e1',
        workflow_run_id: 'r1',
        step_id: 's1',
        engine: 'pi',
        phase: 'intent',
        call_seq: 3,
        session_ref: { kind: 'pi', treeId: 't1' },
        resume_node_id: 'node-1',
        transcript_locator: 'gs://bucket/path',
        tool_name: 'http.post',
        idempotency_key: 'sha256-abc',
      });
    });
  });

  describe('findLatest', () => {
    it('returns the latest checkpoint by call_seq for (run, step)', async () => {
      const intent = buildEntity({ phase: 'intent', call_seq: 2 });
      typeormRepo.findOne = vi.fn().mockResolvedValue(intent);

      const latest = await repo.findLatest('r1', 's1');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { workflow_run_id: 'r1', step_id: 's1' },
        order: { call_seq: 'DESC', created_at: 'DESC' },
      });
      expect(latest?.call_seq).toBe(2);
      expect(latest?.phase).toBe('intent');
    });

    it('returns null when no checkpoint exists', async () => {
      typeormRepo.findOne = vi.fn().mockResolvedValue(null);
      const result = await repo.findLatest('r1', 's1');
      expect(result).toBeNull();
    });
  });

  describe('recordCheckpoint', () => {
    it('uses provided execution_id in the stored entity', async () => {
      typeormRepo.findOne = vi.fn().mockResolvedValue(null);
      const inserted: StepSessionCheckpointEntity[] = [];
      typeormRepo.insert = vi
        .fn()
        .mockImplementation((entity: StepSessionCheckpointEntity) => {
          inserted.push(entity);
        });

      await repo.recordCheckpoint({
        run_id: 'r1',
        job_id: 's1',
        execution_id: 'exec-parent-1',
        session_tree_id: 'tree-1',
        session_ref: { kind: 'pi', treeId: 'tree-1' },
        engine: 'pi',
        phase: 'result',
      });

      expect(inserted[0]).toMatchObject({
        execution_id: 'exec-parent-1',
        workflow_run_id: 'r1',
        step_id: 's1',
        call_seq: 0,
        phase: 'result',
      });
    });

    it('falls back to run_id when execution_id is not provided', async () => {
      typeormRepo.findOne = vi.fn().mockResolvedValue(null);
      const inserted: StepSessionCheckpointEntity[] = [];
      typeormRepo.insert = vi
        .fn()
        .mockImplementation((entity: StepSessionCheckpointEntity) => {
          inserted.push(entity);
        });

      await repo.recordCheckpoint({
        run_id: 'r1',
        job_id: 's1',
        session_tree_id: 'tree-1',
        session_ref: { kind: 'pi', treeId: 'tree-1' },
        engine: 'pi',
        phase: 'result',
      });

      expect(inserted[0]).toMatchObject({
        execution_id: 'r1',
        call_seq: 0,
        phase: 'result',
      });
    });

    it('computes next call_seq from existing checkpoint and findLatest returns recovery row', async () => {
      const intentCkpt = buildEntity({
        phase: 'intent',
        call_seq: 5,
        workflow_run_id: 'r1',
        step_id: 's1',
      });
      typeormRepo.findOne = vi.fn().mockResolvedValue(intentCkpt);
      const inserted: StepSessionCheckpointEntity[] = [];
      typeormRepo.insert = vi
        .fn()
        .mockImplementation((entity: StepSessionCheckpointEntity) => {
          inserted.push(entity);
        });

      await repo.recordCheckpoint({
        run_id: 'r1',
        job_id: 's1',
        execution_id: 'exec-parent-1',
        session_tree_id: 'tree-1',
        session_ref: { kind: 'pi', treeId: 'tree-1' },
        engine: 'pi',
        phase: 'result',
      });

      expect(inserted[0]).toMatchObject({
        execution_id: 'exec-parent-1',
        workflow_run_id: 'r1',
        step_id: 's1',
        call_seq: 6,
        phase: 'result',
      });

      const savedRecovery = buildEntity({
        phase: 'result',
        call_seq: 6,
        workflow_run_id: 'r1',
        step_id: 's1',
      });
      typeormRepo.findOne = vi.fn().mockResolvedValue(savedRecovery);

      const latest = await repo.findLatest('r1', 's1');
      expect(latest?.phase).toBe('result');
      expect(latest?.call_seq).toBe(6);
    });

    it('uses call_seq 0 when no prior checkpoint exists', async () => {
      typeormRepo.findOne = vi.fn().mockResolvedValue(null);
      const inserted: StepSessionCheckpointEntity[] = [];
      typeormRepo.insert = vi
        .fn()
        .mockImplementation((entity: StepSessionCheckpointEntity) => {
          inserted.push(entity);
        });

      await repo.recordCheckpoint({
        run_id: 'r1',
        job_id: 's1',
        session_tree_id: 'tree-1',
        session_ref: { kind: 'pi', treeId: 'tree-1' },
        engine: 'pi',
        phase: 'result',
      });

      expect(inserted[0]).toMatchObject({ call_seq: 0, phase: 'result' });
    });
  });

  describe('hasResultFor', () => {
    it('returns true when a result checkpoint exists for (run, step, callSeq)', async () => {
      typeormRepo.count = vi.fn().mockResolvedValue(1);

      const result = await repo.hasResultFor('r1', 's1', 5);

      expect(typeormRepo.count).toHaveBeenCalledWith({
        where: {
          workflow_run_id: 'r1',
          step_id: 's1',
          call_seq: 5,
          phase: 'result',
        },
      });
      expect(result).toBe(true);
    });

    it('detects an intent with no matching result', async () => {
      typeormRepo.count = vi.fn().mockResolvedValue(0);

      const result = await repo.hasResultFor('r1', 's1', 5);

      expect(result).toBe(false);
    });

    it('returns false when count is 0', async () => {
      typeormRepo.count = vi.fn().mockResolvedValue(0);
      expect(await repo.hasResultFor('r1', 's1', 99)).toBe(false);
    });
  });
});
