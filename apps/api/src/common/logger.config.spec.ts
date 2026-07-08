import { describe, expect, it } from 'vitest';
import { getApiLogLevel, getNestLoggerLevels } from './logger.config';

describe('getApiLogLevel', () => {
  it('defaults API logs to info', () => {
    expect(getApiLogLevel({})).toBe('info');
  });

  it('allows debug logs when LOG_LEVEL is debug', () => {
    expect(getApiLogLevel({ LOG_LEVEL: 'debug' })).toBe('debug');
  });

  it('falls back to info for unsupported LOG_LEVEL values', () => {
    expect(getApiLogLevel({ LOG_LEVEL: 'verbose' })).toBe('info');
  });
});

describe('getNestLoggerLevels', () => {
  it('excludes debug from the Nest bootstrap logger at the default info level', () => {
    expect(getNestLoggerLevels('info')).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
    ]);
  });

  it('includes debug for the Nest bootstrap logger when API logging is debug', () => {
    expect(getNestLoggerLevels('debug')).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
    ]);
  });
});
