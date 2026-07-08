import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { HarnessCredentialBindingEntity } from './harness-credential-binding.entity';

describe('HarnessCredentialBindingEntity', () => {
  it('maps to the harness_credential_binding table', () => {
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === HarnessCredentialBindingEntity,
    );
    expect(table?.name).toBe('harness_credential_binding');
  });

  it('declares a nullable scope_node_id column (NULL = platform)', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) =>
        c.target === HarnessCredentialBindingEntity &&
        c.options.name === 'scope_node_id',
    );
    expect(column).toBeDefined();
    expect(column?.options.nullable).toBe(true);
  });

  it('declares non-null harness_id, credential_key, auth_type, secret_id columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === HarnessCredentialBindingEntity,
    );
    const names = columns.map((c) => c.options.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'harness_id',
        'credential_key',
        'auth_type',
        'secret_id',
      ]),
    );
  });

  it('holds field values on a constructed instance', () => {
    const binding = new HarnessCredentialBindingEntity();
    binding.harnessId = 'claude-code';
    binding.credentialKey = 'anthropic';
    binding.authType = 'api_key';
    binding.secretId = '11111111-1111-1111-1111-111111111111';
    binding.scopeNodeId = null;
    expect(binding.scopeNodeId).toBeNull();
    expect(binding.credentialKey).toBe('anthropic');
  });
});
