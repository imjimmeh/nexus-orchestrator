import { describe, it, expect } from 'vitest';
import { Workflow } from '../workflow/database/entities/workflow.entity';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';

describe('override columns on configurable entities', () => {
  it('Workflow carries scope_node_id, source, locked, overrides, base_ref', () => {
    const w = new Workflow();
    w.scope_node_id = null;
    w.source = 'seeded';
    w.locked = false;
    w.overrides = null;
    w.base_ref = null;
    expect(w.source).toBe('seeded');
  });

  it('AgentProfile carries scope_node_id, locked, overrides, base_ref', () => {
    const p = new AgentProfile();
    p.scope_node_id = null;
    p.locked = false;
    p.overrides = null;
    p.base_ref = null;
    expect(p.locked).toBe(false);
  });
});
