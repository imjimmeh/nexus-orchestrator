import { describe, expect, it } from 'vitest';
import { readAgentProfileLookups } from './chat-to-core-action.utils';

describe('readAgentProfileLookups', () => {
  it('parses tier_preference from snake_case payload', () => {
    const result = readAgentProfileLookups([
      {
        id: 'profile-1',
        name: 'spec-generator',
        is_active: true,
        tier_preference: 'heavy',
      },
    ]);

    expect(result).toEqual([
      {
        id: 'profile-1',
        name: 'spec-generator',
        isActive: true,
        tier_preference: 'heavy',
      },
    ]);
  });

  it('parses tier_preference from camelCase payload', () => {
    const result = readAgentProfileLookups([
      {
        id: 'profile-2',
        name: 'light-agent',
        isActive: true,
        tierPreference: 'light',
      },
    ]);

    expect(result).toEqual([
      {
        id: 'profile-2',
        name: 'light-agent',
        isActive: true,
        tier_preference: 'light',
      },
    ]);
  });
});
