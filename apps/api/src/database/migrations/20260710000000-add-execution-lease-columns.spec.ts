import { describe, expect, it, vi } from 'vitest';
import { AddExecutionLeaseColumns20260710000000 } from './20260710000000-add-execution-lease-columns';

describe('AddExecutionLeaseColumns migration', () => {
  it('adds owner lease and progress columns with the lookup index', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddExecutionLeaseColumns20260710000000().up({ query } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    expect(sql).toContain('owner_instance_id');
    expect(sql).toContain('owner_lease_expires_at');
    expect(sql).toContain('last_progress_at');
    expect(sql).toContain('idx_executions_state_owner_lease_expires_at');
  });

  it('drops the lookup index and owner lease columns in down()', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddExecutionLeaseColumns20260710000000().down({ query } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS idx_executions_state_owner_lease_expires_at',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS owner_instance_id');
  });
});
