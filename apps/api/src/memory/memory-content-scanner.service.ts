import { Injectable, BadRequestException } from '@nestjs/common';

const THREAT_PATTERNS = [
  {
    pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i,
    id: 'prompt_injection',
  },
  { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  {
    pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i,
    id: 'disregard_rules',
  },
  {
    pattern:
      /act\s+as\s+(if|though)\s+you\s+(have\s+no|don'?t\s+have)\s+(restrictions|limits|rules)/i,
    id: 'bypass_restrictions',
  },
  {
    pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    id: 'exfil_curl',
  },
  {
    pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    id: 'exfil_wget',
  },
  {
    pattern:
      /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
    id: 'read_secrets',
  },
  { pattern: /authorized_keys/i, id: 'ssh_backdoor' },
  { pattern: /\$HOME\/\.ssh|~\/\.ssh/i, id: 'ssh_access' },
];

const SECRET_PATTERNS = [
  { pattern: /\bsk-ant-api\S{10,}\b/, id: 'anthropic_api_key' },
  { pattern: /\bsk-or-v1-\S{10,}\b/, id: 'openrouter_api_key' },
  { pattern: /\bsk-\S{20,}\b/, id: 'openai_api_key' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, id: 'aws_access_key' },
  { pattern: /\bghp_\S{10,}\b/, id: 'github_personal_token' },
  { pattern: /\bghu_\S{10,}\b/, id: 'github_user_token' },
  { pattern: /\bxoxb-\S{10,}\b/, id: 'slack_bot_token' },
  { pattern: /\bxapp-\S{10,}\b/, id: 'slack_app_token' },
  { pattern: /\bntn_\S{10,}\b/, id: 'notion_token' },
  { pattern: /\bBearer\s+\S{20,}\b/, id: 'bearer_auth_token' },
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\sKEY-----/,
    id: 'private_key_block',
  },
  { pattern: /\bANTHROPIC_API_KEY\b/, id: 'env_anthropic_key' },
  { pattern: /\bOPENAI_API_KEY\b/, id: 'env_openai_key' },
  { pattern: /\bOPENROUTER_API_KEY\b/, id: 'env_openrouter_key' },
  { pattern: /\bGITHUB_TOKEN\b/, id: 'env_github_token' },
  { pattern: /\bAWS_SECRET_ACCESS_KEY\b/, id: 'env_aws_secret' },
  { pattern: /\bDATABASE_URL\b/, id: 'env_database_url' },
  { pattern: /\bpassword\s*[=:]\s*\S{6,}\b/i, id: 'password_assignment' },
  { pattern: /\bsecret\s*[=:]\s*\S{6,}\b/i, id: 'secret_assignment' },
  { pattern: /\btoken\s*[=:]\s*\S{10,}\b/i, id: 'token_assignment' },
];

const INVISIBLE_CHARS = new Set([
  '\u200b',
  '\u200c',
  '\u200d',
  '\u2060',
  '\ufeff',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
]);

@Injectable()
export class MemoryContentScannerService {
  /**
   * Scans memory content for injection threats, credentials, and invisible unicode.
   * Throws BadRequestException if a security violation is detected.
   */
  scanContent(content: string): void {
    if (!content) {
      return;
    }

    // Check invisible characters
    for (const char of content) {
      if (INVISIBLE_CHARS.has(char)) {
        throw new BadRequestException(
          `Security violation: content contains invisible unicode character U+${char
            .charCodeAt(0)
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')} (possible injection).`,
        );
      }
    }

    // Check threat patterns
    for (const { pattern, id } of THREAT_PATTERNS) {
      if (pattern.test(content)) {
        throw new BadRequestException(
          `Security violation: content matches threat pattern '${id}'. Memory writes are subject to security auditing and must not contain injection or exfiltration payloads.`,
        );
      }
    }

    // Check secret patterns
    for (const { pattern, id } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        throw new BadRequestException(
          `Security violation: content matches credential pattern '${id}'. Persistent storage of API keys, tokens, or credentials is prohibited.`,
        );
      }
    }
  }
}
