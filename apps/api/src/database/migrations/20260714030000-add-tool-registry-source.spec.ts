import { describe, expect, it, vi } from 'vitest';
import { AddToolRegistrySource20260714030000 } from './20260714030000-add-tool-registry-source';

describe('AddToolRegistrySource migration', () => {
  it('adds the source column with a manual default', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddToolRegistrySource20260714030000().up({ query } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source');
    expect(sql).toContain("DEFAULT 'manual'");
  });

  it('drops the source column in down()', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddToolRegistrySource20260714030000().down({ query } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    expect(sql).toContain('DROP COLUMN IF EXISTS source');
  });
});
