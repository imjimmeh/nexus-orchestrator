import { HarnessDefinitionEntity } from './harness-definition.entity';

it('declares the harness definition columns', () => {
  const e = new HarnessDefinitionEntity();
  e.harnessId = 'custom:acme';
  e.displayName = 'Acme';
  e.source = 'custom';
  e.capabilities = { toolModel: 'permission_callback' } as never;
  e.imageRef = 'acme/harness:1';
  e.transport = 'kernel';
  e.enabled = true;
  e.defaultEnv = {};
  e.policyScope = {};
  expect(e.harnessId).toBe('custom:acme');
  expect(e.source).toBe('custom');
});
