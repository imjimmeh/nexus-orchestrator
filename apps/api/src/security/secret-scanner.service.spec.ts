import { Test, TestingModule } from '@nestjs/testing';
import { SecretScannerService } from './secret-scanner.service';

describe('SecretScannerService', () => {
  let service: SecretScannerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SecretScannerService],
    }).compile();

    service = module.get<SecretScannerService>(SecretScannerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should redact OpenAI API keys', () => {
    const content = 'My key is sk-1234567890abcdef1234567890abcdef12345678';
    const { redactedContent, foundSecrets } = service.scanAndRedact(content);
    expect(foundSecrets).toBe(true);
    expect(redactedContent).toContain('[REDACTED]');
    expect(redactedContent).not.toContain('sk-12345678');
  });

  it('should redact AWS credentials', () => {
    const content = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    const { redactedContent, foundSecrets } = service.scanAndRedact(content);
    expect(foundSecrets).toBe(true);
    expect(redactedContent).toContain('AWS_ACCESS_KEY_ID: [REDACTED]');
  });

  it('should redact passwords', () => {
    const content = '{"password":"supersecretpassword123"}';
    const { redactedContent, foundSecrets } = service.scanAndRedact(content);
    expect(foundSecrets).toBe(true);
    expect(redactedContent).toContain('"password": [REDACTED]');
  });

  it('should redact private keys', () => {
    const content =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA75...\n-----END RSA PRIVATE KEY-----';
    const { redactedContent, foundSecrets } = service.scanAndRedact(content);
    expect(foundSecrets).toBe(true);
    expect(redactedContent).toContain('[REDACTED]');
  });
});
