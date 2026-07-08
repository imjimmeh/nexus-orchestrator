import { describe, expect, it, vi } from 'vitest';
import { AddThinkingLevelColumns20260709000000 } from './20260709000000-add-thinking-level-columns';

describe('AddThinkingLevelColumns migration', () => {
  it('adds both nullable columns', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new AddThinkingLevelColumns20260709000000().up({ query } as never);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('"llm_models" ADD COLUMN');
    expect(sql).toContain('default_thinking_level');
    expect(sql).toContain('"agent_profiles" ADD COLUMN');
    expect(sql).toContain('thinking_level');
  });

  it('drops both columns in down()', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new AddThinkingLevelColumns20260709000000().down({ query } as never);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('"agent_profiles" DROP COLUMN');
    expect(sql).toContain('"llm_models" DROP COLUMN');
  });
});
