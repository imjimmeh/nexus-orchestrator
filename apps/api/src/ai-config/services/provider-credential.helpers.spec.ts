import { describe, expect, it } from 'vitest';
import {
  deriveApiKeyField,
  buildSecretValueMap,
  headersToRecord,
  applyCredentialRuntimeEnv,
} from './provider-credential.helpers';

describe('deriveApiKeyField', () => {
  it('uses the provider-scoped convention for a known preset', () => {
    expect(deriveApiKeyField('openai')).toBe('OPENAI_API_KEY');
    expect(deriveApiKeyField('anthropic')).toBe('ANTHROPIC_API_KEY');
  });

  it('normalizes non-alphanumeric characters to underscores', () => {
    expect(deriveApiKeyField('google-vertex')).toBe('GOOGLE_VERTEX_API_KEY');
  });

  it('falls back to API_KEY for custom or empty providers', () => {
    expect(deriveApiKeyField('custom')).toBe('API_KEY');
    expect(deriveApiKeyField('')).toBe('API_KEY');
    expect(deriveApiKeyField(undefined)).toBe('API_KEY');
    expect(deriveApiKeyField(null)).toBe('API_KEY');
  });
});

describe('buildSecretValueMap', () => {
  it('includes the api key under the derived field and spreads extra', () => {
    expect(
      buildSecretValueMap({
        apiKeyField: 'OPENAI_API_KEY',
        apiKey: 'sk-test',
        extra: { ORG_ID: 'org_1' },
      }),
    ).toEqual({ OPENAI_API_KEY: 'sk-test', ORG_ID: 'org_1' });
  });

  it('omits the api key field when the key is blank (keep-existing on edit)', () => {
    expect(
      buildSecretValueMap({
        apiKeyField: 'OPENAI_API_KEY',
        apiKey: '',
        extra: { ORG_ID: 'org_1' },
      }),
    ).toEqual({ ORG_ID: 'org_1' });
  });

  it('returns an empty object when nothing is supplied', () => {
    expect(buildSecretValueMap({ apiKeyField: 'API_KEY' })).toEqual({});
  });
});

describe('headersToRecord', () => {
  it('converts pairs to a record', () => {
    expect(
      headersToRecord([
        { name: 'X-Title', value: 'nexus' },
        { name: 'X-Auth', value: '{{TOKEN}}' },
      ]),
    ).toEqual({ 'X-Title': 'nexus', 'X-Auth': '{{TOKEN}}' });
  });

  it('returns undefined for empty or missing input', () => {
    expect(headersToRecord(undefined)).toBeUndefined();
    expect(headersToRecord([])).toBeUndefined();
  });
});

describe('applyCredentialRuntimeEnv', () => {
  it('pins api_key_field and leaves providerConfig untouched without headers', () => {
    expect(
      applyCredentialRuntimeEnv({
        runtimeEnv: { pi_provider: 'openai' },
        apiKeyField: 'OPENAI_API_KEY',
      }),
    ).toEqual({ pi_provider: 'openai', api_key_field: 'OPENAI_API_KEY' });
  });

  it('merges headers into providerConfig without clobbering existing config', () => {
    expect(
      applyCredentialRuntimeEnv({
        runtimeEnv: {
          pi_provider: 'openai',
          providerConfig: { name: 'OpenAI', headers: { 'X-Existing': 'a' } },
        },
        apiKeyField: 'OPENAI_API_KEY',
        headerRecord: { 'X-Title': 'nexus' },
      }),
    ).toEqual({
      pi_provider: 'openai',
      api_key_field: 'OPENAI_API_KEY',
      providerConfig: {
        name: 'OpenAI',
        headers: { 'X-Existing': 'a', 'X-Title': 'nexus' },
      },
    });
  });
});
