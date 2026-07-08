import { describe, expect, it } from 'vitest';

import { createNodemailerTransportFactory } from './mailer-transport';

describe('createNodemailerTransportFactory', () => {
  it('builds a transport exposing sendMail', () => {
    const factory = createNodemailerTransportFactory();

    const transport = factory({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    });

    expect(typeof transport.sendMail).toBe('function');
  });
});
