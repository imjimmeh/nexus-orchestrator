import { describe, expect, it } from 'vitest';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import type { AgentProfileRollbackSnapshot } from './agent-profile-change.applier.types';
import {
  buildProfileRollbackSnapshot,
  buildProfileUpdateRequest,
  parseProfileRollbackSnapshot,
  splitRollbackRestore,
} from './agent-profile-change.applier.helpers';

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-uuid-1',
    name: 'implementation-agent',
    system_prompt: 'Base prompt.',
    model_name: null,
    provider_name: null,
    thinking_level: null,
    tool_policy: { default: 'deny', rules: [] },
    assigned_skills: ['testing-unit-patterns'],
    overrides: null,
    ...overrides,
  } as AgentProfile;
}

function makeSnapshot(
  overrides: Partial<AgentProfileRollbackSnapshot> = {},
): AgentProfileRollbackSnapshot {
  return {
    profileId: 'profile-uuid-1',
    profileName: 'implementation-agent',
    system_prompt: 'Base prompt.',
    model_name: null,
    provider_name: null,
    thinking_level: null,
    tool_policy: { default: 'deny', rules: [] },
    assigned_skills: ['testing-unit-patterns'],
    overrides: null,
    ...overrides,
  };
}

describe('buildProfileRollbackSnapshot', () => {
  it('captures all 7 patchable fields plus profile name and id', () => {
    const snapshot = buildProfileRollbackSnapshot(
      makeProfile({
        model_name: 'gpt-5',
        provider_name: 'openai',
        thinking_level: 'high',
        overrides: { admin_custom: true },
      }),
    );
    expect(snapshot).toEqual({
      profileId: 'profile-uuid-1',
      profileName: 'implementation-agent',
      system_prompt: 'Base prompt.',
      model_name: 'gpt-5',
      provider_name: 'openai',
      thinking_level: 'high',
      tool_policy: { default: 'deny', rules: [] },
      assigned_skills: ['testing-unit-patterns'],
      overrides: { admin_custom: true },
    });
  });
});

describe('buildProfileUpdateRequest', () => {
  it('appends to an existing system prompt', () => {
    const request = buildProfileUpdateRequest(makeProfile(), {
      system_prompt: { mode: 'append', value: 'Always run the linter.' },
    });
    expect(request).toEqual({
      system_prompt: 'Base prompt.\n\nAlways run the linter.',
    });
  });

  it('replaces the system prompt instead of appending', () => {
    const request = buildProfileUpdateRequest(makeProfile(), {
      system_prompt: { mode: 'replace', value: 'New prompt.' },
    });
    expect(request).toEqual({ system_prompt: 'New prompt.' });
  });

  it('only sets the fields present in the patch', () => {
    const request = buildProfileUpdateRequest(makeProfile(), {
      thinking_level: 'medium',
    });
    expect(request).toEqual({ thinking_level: 'medium' });
  });

  it('omits assigned_skills — routed through AgentSkillsService instead', () => {
    const request = buildProfileUpdateRequest(makeProfile(), {
      assigned_skills: { add: ['workflow-yaml-authoring'] },
    });
    expect(request).toEqual({});
  });
});

describe('splitRollbackRestore', () => {
  it('routes tool_policy, system_prompt, and thinking_level to serviceFields', () => {
    const { serviceFields } = splitRollbackRestore(
      makeSnapshot({ thinking_level: 'high' }),
    );
    expect(serviceFields).toEqual({
      tool_policy: { default: 'deny', rules: [] },
      thinking_level: 'high',
      system_prompt: 'Base prompt.',
    });
  });

  it('routes assigned_skills, overrides, and a null model_name to rawFields', () => {
    const { rawFields } = splitRollbackRestore(
      makeSnapshot({ model_name: null, overrides: { legacy: true } }),
    );
    expect(rawFields).toEqual({
      assigned_skills: ['testing-unit-patterns'],
      overrides: { legacy: true },
      model_name: null,
      provider_name: null,
    });
  });

  it('routes a non-null model_name/provider_name to serviceFields', () => {
    const { serviceFields, rawFields } = splitRollbackRestore(
      makeSnapshot({ model_name: 'gpt-5', provider_name: 'openai' }),
    );
    expect(serviceFields.model_name).toBe('gpt-5');
    expect(serviceFields.provider_name).toBe('openai');
    expect(rawFields.model_name).toBeUndefined();
    expect(rawFields.provider_name).toBeUndefined();
  });

  it('routes a null system_prompt to rawFields, not serviceFields', () => {
    const { serviceFields, rawFields } = splitRollbackRestore(
      makeSnapshot({ system_prompt: null }),
    );
    expect(rawFields.system_prompt).toBeNull();
    expect(serviceFields.system_prompt).toBeUndefined();
  });
});

describe('parseProfileRollbackSnapshot', () => {
  it('throws when rollback_data is absent', () => {
    expect(() => parseProfileRollbackSnapshot(null)).toThrow();
  });

  it('throws when rollback_data is malformed (no profileId)', () => {
    expect(() =>
      parseProfileRollbackSnapshot({ system_prompt: 'x' }),
    ).toThrow();
  });

  it('parses a well-formed snapshot', () => {
    const snapshot = parseProfileRollbackSnapshot(makeSnapshot());
    expect(snapshot).toEqual(makeSnapshot());
  });
});
