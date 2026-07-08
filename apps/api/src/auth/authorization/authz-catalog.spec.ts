import { describe, it, expect } from 'vitest';
import { RESOURCES, permissionName } from './permission-catalog';

describe('audit catalog resource', () => {
  it('includes audit in RESOURCES', () => {
    expect(RESOURCES).toContain('audit');
  });

  it('generates audit:read permission name', () => {
    expect(permissionName('audit', 'read')).toBe('audit:read');
  });
});
