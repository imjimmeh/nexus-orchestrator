const MAX_COMPLETION_MESSAGE_LENGTH = 500;
const TRUNCATED_MESSAGE_SUFFIX = '... [truncated]';
const SENSITIVE_KEY_PATTERN =
  '(?:token|api[_-]?key|apiKey|password|secret|credential|authorization|bearer)';

const KEY_VALUE_SECRET_PATTERN = new RegExp(
  `(["']?\\b${SENSITIVE_KEY_PATTERN}\\b["']?\\s*[:=]\\s*)(?:(["'])(.*?)\\2|([^\\s]+))`,
  'gi',
);
const NATURAL_LANGUAGE_SECRET_PATTERN = new RegExp(
  `(\\b${SENSITIVE_KEY_PATTERN}\\b\\s+is\\s+)([^\r\n.!?,;:]+)([.!?,;:]|$)`,
  'gi',
);
const DOTTED_NATURAL_LANGUAGE_SECRET_PATTERN = new RegExp(
  `(\\b${SENSITIVE_KEY_PATTERN}\\b\\s+is\\s+)([A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)+)([.!?,;:]?)(?=\\s|$)`,
  'gi',
);
const AUTHORIZATION_BEARER_SECRET_PATTERN =
  /(\bauthorization\b\s*[:=]\s*)Bearer\s+[^\s]+/gi;
const BARE_PROVIDER_TOKEN_PATTERN =
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\b/g;
const YAML_BLOCK_SECRET_PATTERN = new RegExp(
  `["']?\\b${SENSITIVE_KEY_PATTERN}\\b["']?\\s*:\\s*[|>]`,
  'gi',
);

export function sanitizeCompletionMessage(message: string): string {
  const redacted = redactYamlBlockSecrets(message)
    .replace(
      AUTHORIZATION_BEARER_SECRET_PATTERN,
      (_match, prefix: string) => `${prefix}[REDACTED]`,
    )
    .replace(
      KEY_VALUE_SECRET_PATTERN,
      (_match, prefix: string, quote: string) =>
        quote ? `${prefix}${quote}[REDACTED]${quote}` : `${prefix}[REDACTED]`,
    )
    .replace(
      DOTTED_NATURAL_LANGUAGE_SECRET_PATTERN,
      (_match, prefix: string, _value: string, terminator: string) =>
        `${prefix}[REDACTED]${terminator}`,
    )
    .replace(
      NATURAL_LANGUAGE_SECRET_PATTERN,
      (_match, prefix: string, _value: string, terminator: string) =>
        `${prefix}[REDACTED]${terminator}`,
    )
    .replace(BARE_PROVIDER_TOKEN_PATTERN, '[REDACTED]');

  if (redacted.length <= MAX_COMPLETION_MESSAGE_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(
    0,
    MAX_COMPLETION_MESSAGE_LENGTH - TRUNCATED_MESSAGE_SUFFIX.length,
  )}${TRUNCATED_MESSAGE_SUFFIX}`;
}

function redactYamlBlockSecrets(message: string): string {
  const lines = message.split(/\r?\n/);
  const redactedLines: string[] = [];
  let skipSecretBlockLines = 0;

  for (const line of lines) {
    if (
      skipSecretBlockLines > 0 &&
      line.trim().length > 0 &&
      line.length <= 120
    ) {
      skipSecretBlockLines -= 1;
      continue;
    }
    skipSecretBlockLines = 0;

    if (YAML_BLOCK_SECRET_PATTERN.test(line)) {
      YAML_BLOCK_SECRET_PATTERN.lastIndex = 0;
      redactedLines.push(
        line.replace(YAML_BLOCK_SECRET_PATTERN, (match) =>
          match.replace(/[|>]\s*$/, '[REDACTED]'),
        ),
      );
      skipSecretBlockLines = 10;
      continue;
    }
    YAML_BLOCK_SECRET_PATTERN.lastIndex = 0;

    redactedLines.push(line);
  }

  return redactedLines.join('\n');
}
