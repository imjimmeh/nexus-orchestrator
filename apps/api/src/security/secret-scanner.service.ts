import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SecretScannerService {
  private readonly logger = new Logger(SecretScannerService.name);

  private readonly patterns: RegExp[] = [
    /OPENAI_API_KEY["\s:=]+([a-zA-Z0-9-_]{32,})/i,
    /ANTHROPIC_API_KEY["\s:=]+([a-zA-Z0-9-_]{32,})/i,
    /AWS_ACCESS_KEY_ID["\s:=]+([A-Z0-9]{20})/i,
    /AWS_SECRET_ACCESS_KEY["\s:=]+([a-zA-Z0-9/+=]{40})/i,
    /-----BEGIN (RSA |)PRIVATE KEY-----[\s\S]+-----END (RSA |)PRIVATE KEY-----/i,
    /password["\s:=]+([^\s"]{8,})/i,
    /api[_-]?key["\s:=]+([a-zA-Z0-9-_]{32,})/i,
    /sk-[a-zA-Z0-9]{32,}/i, // Standalone OpenAI keys
  ];

  scanAndRedact(content: string): {
    redactedContent: string;
    foundSecrets: boolean;
  } {
    let redactedContent = content;
    let foundSecrets = false;

    for (const pattern of this.patterns) {
      if (pattern.test(redactedContent)) {
        foundSecrets = true;
        redactedContent = redactedContent.replace(pattern, (match) => {
          this.logger.warn(`Potential secret detected and redacted`);
          const parts = match.split(/[:=]/);
          if (parts.length > 1) {
            return parts[0] + ': [REDACTED]';
          }
          return '[REDACTED]';
        });
      }
    }

    return { redactedContent, foundSecrets };
  }

  scanJSONL(nodes: unknown[]): {
    redactedNodes: unknown[];
    foundSecrets: boolean;
  } {
    let foundSecretsTotal = false;
    const redactedNodes = nodes.map((node) => {
      const json = JSON.stringify(node);
      const { redactedContent, foundSecrets } = this.scanAndRedact(json);
      if (foundSecrets) foundSecretsTotal = true;
      return JSON.parse(redactedContent) as unknown;
    });

    return { redactedNodes, foundSecrets: foundSecretsTotal };
  }
}
