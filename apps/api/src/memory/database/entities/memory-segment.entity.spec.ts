import { beforeEach, describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { MemorySegment } from './memory-segment.entity';

describe('MemorySegment entity', () => {
  it('maps nullable jsonb provenance metadata and preserves existing columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === MemorySegment,
    );
    const columnNames = columns.map(
      (column) => column.options.name ?? column.propertyName,
    );
    const metadataColumn = columns.find(
      (column) =>
        (column.options.name ?? column.propertyName) === 'metadata_json',
    );

    expect(columnNames).toEqual(
      expect.arrayContaining([
        'id',
        'entity_type',
        'entity_id',
        'memory_type',
        'content',
        'version',
        'metadata_json',
        'created_at',
        'updated_at',
      ]),
    );
    expect(metadataColumn?.options.type).toBe('jsonb');
    expect(metadataColumn?.options.nullable).toBe(true);
  });

  it('exposes the usage-based eviction columns added by the reaper milestone', () => {
    // work item bef49c3a-0c0f-4c85-b134-29d839c72bad. The reaper reads
    // these four columns to decide whether a segment is eligible for
    // auto-eviction. The contract here is "the columns exist, are typed
    // correctly, and have the right nullability" — anything else is
    // owned by the reaper service spec and the integration milestone.
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === MemorySegment,
    );
    const columnByName = new Map(
      columns.map((column) => [
        column.options.name ?? column.propertyName,
        column,
      ]),
    );

    const lastAccessedAt = columnByName.get('last_accessed_at');
    expect(lastAccessedAt, 'last_accessed_at column registered').toBeDefined();
    expect(lastAccessedAt?.options.type).toBe('timestamptz');
    expect(lastAccessedAt?.options.nullable).toBe(true);

    const accessCount = columnByName.get('access_count');
    expect(accessCount, 'access_count column registered').toBeDefined();
    expect(accessCount?.options.type).toBe('int');
    expect(accessCount?.options.default).toBe(0);

    const pinned = columnByName.get('pinned');
    expect(pinned, 'pinned column registered').toBeDefined();
    expect(pinned?.options.type).toBe('boolean');
    expect(pinned?.options.default).toBe(false);

    const source = columnByName.get('source');
    expect(source, 'source column registered').toBeDefined();
    expect(source?.options.type).toBe('varchar');
    expect(source?.options.nullable).toBe(true);
  });

  it('exposes the confidence-decay columns added by the decay reaper milestone', () => {
    // work item 3d7fb798-f54d-40ff-a803-438224474912 (schema migration
    // milestone). The follow-up nightly MemoryDecayReaper reads
    // `last_reinforced_at` together with the eviction-style
    // `last_accessed_at` to decide whether a segment is "fresh
    // enough" to skip decay, and uses `archived_at` as the
    // soft-archive marker when decayed confidence falls below the
    // floor. The contract here is "the columns exist, are typed
    // correctly, and have the right nullability" — anything else
    // is owned by the decay reaper service spec and the
    // integration milestone.
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === MemorySegment,
    );
    const columnByName = new Map(
      columns.map((column) => [
        column.options.name ?? column.propertyName,
        column,
      ]),
    );

    const lastReinforcedAt = columnByName.get('last_reinforced_at');
    expect(
      lastReinforcedAt,
      'last_reinforced_at column registered',
    ).toBeDefined();
    expect(lastReinforcedAt?.options.type).toBe('timestamptz');
    expect(lastReinforcedAt?.options.nullable).toBe(true);

    const archivedAt = columnByName.get('archived_at');
    expect(archivedAt, 'archived_at column registered').toBeDefined();
    expect(archivedAt?.options.type).toBe('timestamptz');
    expect(archivedAt?.options.nullable).toBe(true);
  });

  it('exposes the drift-detection column added by the drift detector milestone', () => {
    // work item 0cead042-e823-4e26-9386-02042252ffb0 (schema migration
    // milestone). The follow-up nightly `MemoryDriftDetectionService`
    // stamps `drift_detected_at` when a segment's underlying reality
    // (file path, schema column, or API endpoint referenced by
    // `source_metadata`) no longer matches the codebase, alongside
    // the confidence penalty applied to `metadata_json.confidence`.
    // The detector never clears the column — a segment that has
    // drifted once is permanently marked for auditability. The
    // contract here is "the column exists, is typed correctly, and
    // has the right nullability" — anything else is owned by the
    // drift detector service spec (milestone 2) and the integration
    // milestone.
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === MemorySegment,
    );
    const columnByName = new Map(
      columns.map((column) => [
        column.options.name ?? column.propertyName,
        column,
      ]),
    );

    const driftDetectedAt = columnByName.get('drift_detected_at');
    expect(
      driftDetectedAt,
      'drift_detected_at column registered',
    ).toBeDefined();
    expect(driftDetectedAt?.options.type).toBe('timestamptz');
    expect(driftDetectedAt?.options.nullable).toBe(true);
  });

  describe('@BeforeInsert syncSourceFromMetadata hook', () => {
    // work item 5743ac93-456d-41b3-ae5b-0ca2554318da (Milestone 2,
    // Task 3 — memory write correctness). The
    // `WorkflowFailurePostmortemListener` and the auto-promoted
    // `learning_candidate` flow classify a segment by tagging
    // `metadata_json.source`; the column-level `source` is what
    // the nightly `MemoryDecayReaper` /
    // `MemoryEvictionReaper` use to honour the protected-source
    // allowlist. The hook below bridges that gap so a postmortem
    // written with `metadata_json.source = 'workflow_failure_postmortem'`
    // is also picked up by the column-level exemption check.

    let segment: MemorySegment;

    beforeEach(() => {
      segment = new MemorySegment();
      segment.entity_type = 'project';
      segment.entity_id = 'scope-1';
      segment.content = 'sample content';
      segment.memory_type = 'history';
    });

    it('copies metadata_json.source into the source column when source is unset', () => {
      segment.metadata_json = { source: 'workflow_failure_postmortem' };
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBe('workflow_failure_postmortem');
    });

    it('does not overwrite an explicit source value (idempotency)', () => {
      segment.metadata_json = { source: 'workflow_failure_postmortem' };
      segment.source = 'learning_candidate';

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBe('learning_candidate');
    });

    it('leaves the source column null when metadata_json is null', () => {
      segment.metadata_json = null;
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBeNull();
    });

    it('leaves the source column null when metadata_json.source is missing', () => {
      segment.metadata_json = { other_key: 'value' };
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBeNull();
    });

    it('leaves the source column null when metadata_json.source is not a string', () => {
      segment.metadata_json = { source: 42 };
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBeNull();
    });

    it('leaves the source column null when metadata_json.source is an empty string', () => {
      segment.metadata_json = { source: '' };
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBeNull();
    });

    it('leaves the source column null when metadata_json.source exceeds 64 chars', () => {
      const oversized = 'a'.repeat(65);
      segment.metadata_json = { source: oversized };
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBeNull();
    });

    it('accepts a source value at exactly the 64-char boundary', () => {
      const exactlyAtLimit = 'a'.repeat(64);
      segment.metadata_json = { source: exactlyAtLimit };
      segment.source = null;

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBe(exactlyAtLimit);
    });

    it('treats an empty-string explicit source as already-set (does not overwrite)', () => {
      // The hook short-circuits on any non-null `this.source`,
      // including the empty string — empty strings are still
      // "explicit" from the caller's perspective and the hook
      // must not clobber them.
      segment.metadata_json = { source: 'workflow_failure_postmortem' };
      segment.source = '';

      (
        segment as unknown as { syncSourceFromMetadata: () => void }
      ).syncSourceFromMetadata();

      expect(segment.source).toBe('');
    });

    it('is registered as a @BeforeInsert lifecycle hook on the entity', () => {
      const hooks = getMetadataArgsStorage().entityListeners.filter(
        (listener) => listener.target === MemorySegment,
      );
      const beforeInsert = hooks.flatMap((listener) =>
        listener.type === 'before-insert' ? [listener] : [],
      );
      expect(
        beforeInsert.length,
        'a @BeforeInsert hook is registered on MemorySegment',
      ).toBeGreaterThan(0);
    });
  });
});
