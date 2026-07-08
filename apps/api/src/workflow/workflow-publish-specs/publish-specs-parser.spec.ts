import { describe, expect, it, vi } from 'vitest';
import { parseSpecFile } from './publish-specs-parser';

describe('parseSpecFile', () => {
  it('infers scope as standard when omitted and body is small', () => {
    const result = parseSpecFile(
      'feature-core.md',
      [
        '---',
        'resource_id: TASK-001',
        'title: "Core feature"',
        '---',
        '',
        'Body',
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result?.sourceId).toBe('TASK-001');
    expect(result?.scope).toBe('standard');
  });

  it('infers scope as large when there are > 3 deliverables', () => {
    const result = parseSpecFile(
      'feature-large.md',
      [
        '---',
        'resource_id: TASK-002',
        'title: "Large feature"',
        '---',
        '',
        '## Deliverables',
        '### One',
        '### Two',
        '### Three',
        '### Four',
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('large');
  });

  it('infers scope as large when there are > 10 files referenced', () => {
    const files = Array.from(
      { length: 11 },
      (_, i) => `apps/api/src/file${i}.ts`,
    ).join('\\n');
    const result = parseSpecFile(
      'feature-many-files.md',
      [
        '---',
        'resource_id: TASK-003',
        'title: "Large feature files"',
        '---',
        '',
        files,
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('large');
  });

  it('respects explicit scope standard even if body is large', () => {
    const result = parseSpecFile(
      'feature-explicit-standard.md',
      [
        '---',
        'resource_id: TASK-004',
        'title: "Large feature"',
        'scope: standard',
        '---',
        '',
        '## Deliverables',
        '### One',
        '### Two',
        '### Three',
        '### Four',
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('standard');
  });

  it('parses explicit large scope', () => {
    const result = parseSpecFile(
      'feature-large.md',
      [
        '---',
        'resource_id: TASK-005',
        'title: "Large feature"',
        'scope: large',
        '---',
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('large');
  });

  it('defaults resource_id to filename slug when missing', () => {
    const onWarning = vi.fn();

    const result = parseSpecFile(
      'feature-missing-id.md',
      ['---', 'title: "Feature"', '---'].join('\n'),
      onWarning,
    );

    expect(result).not.toBeNull();
    expect(result?.sourceId).toBe('feature-missing-id');
    expect(onWarning).toHaveBeenCalled();
    expect(onWarning.mock.calls[0][0]).toContain('resource_id');
  });

  it('warns and falls back to standard when scope is invalid', () => {
    const onWarning = vi.fn();

    const result = parseSpecFile(
      'feature-bad-scope.md',
      [
        '---',
        'resource_id: TASK-006',
        'title: "Feature"',
        'scope: giant',
        '---',
      ].join('\n'),
      onWarning,
    );

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('standard');
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0][0]).toContain('invalid scope');
  });

  it('parses dependency source IDs from comma-separated field', () => {
    const result = parseSpecFile(
      'feature-deps.md',
      [
        '---',
        'resource_id: TASK-007',
        'title: "Feature with deps"',
        'depends_on_resource_ids: TASK-010, TASK-011',
        '---',
      ].join('\n'),
    );

    expect(result?.dependsOnSourceIds).toEqual(['TASK-010', 'TASK-011']);
  });

  it('uses source path override when provided', () => {
    const result = parseSpecFile(
      'feature-override.md',
      [
        '---',
        'resource_id: TASK-008',
        'title: "Feature with override"',
        '---',
      ].join('\n'),
      undefined,
      'docs/resources/feature-override.md',
    );

    expect(result?.sourcePath).toBe('docs/resources/feature-override.md');
  });
});
