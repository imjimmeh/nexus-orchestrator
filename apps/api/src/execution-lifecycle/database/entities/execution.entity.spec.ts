import { describe, expect, it } from 'vitest';
import { ExecutionEntity } from './execution.entity';

describe('ExecutionEntity', () => {
  it('constructs with lifecycle fields and a dedicated terminal_at separate from updated_at', () => {
    const row = new ExecutionEntity();
    row.kind = 'subagent';
    row.state = 'running';
    row.version = 0;
    expect(row.kind).toBe('subagent');
    expect(row.state).toBe('running');
    // terminal_at and last_heartbeat_at are distinct optional columns
    expect('terminal_at' in row).toBe(true);
    expect('last_heartbeat_at' in row).toBe(true);
  });

  it('exposes resolved-config columns', () => {
    const row = new ExecutionEntity();
    row.provider = 'anthropic';
    row.model = 'claude-opus-4-8';
    row.harness_id = 'pi';
    row.agent_profile_name = 'ceo';
    row.provider_source = 'scope';
    row.input_tokens = 100;
    row.output_tokens = 50;

    expect(row.provider).toBe('anthropic');
    expect(row.model).toBe('claude-opus-4-8');
    expect(row.harness_id).toBe('pi');
    expect(row.provider_source).toBe('scope');
  });
});
