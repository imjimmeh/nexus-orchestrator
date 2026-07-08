import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type EnvMap = Record<string, string>;

function parseEnvFile(filePath: string): EnvMap {
  const content = readFileSync(filePath, 'utf8');
  const env: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1);
    env[key] = value;
  }

  return env;
}

function maskSecret(secret: string): string {
  if (secret.length <= 12) {
    return secret;
  }
  return `${secret.slice(0, 8)}...${secret.slice(-6)}`;
}

function required(env: EnvMap, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing ${key} in .env`);
  }
  return value;
}

async function main(): Promise<void> {
  const rootEnvPath = resolve(process.cwd(), '.env');
  const env = parseEnvFile(rootEnvPath);

  const apiKey = required(env, 'E2E_PROVIDER_API_KEY');
  const baseUrl = required(env, 'E2E_PROVIDER_BASE_URL').replace(/\/+$/, '');
  const model = env.E2E_MODEL_NAME || 'MiniMaxAI/MiniMax-M2.5-TEE';
  const endpoint = `${baseUrl}/chat/completions`;

  console.log('Testing provider with:');
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Model: ${model}`);
  console.log(`  API Key (masked): ${maskSecret(apiKey)}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly OK' }],
      max_tokens: 8,
      temperature: 0,
    }),
  });

  console.log(`\nStatus: ${response.status} ${response.statusText}`);
  console.log('Headers:');
  for (const [header, value] of response.headers.entries()) {
    console.log(`  ${header}: ${value}`);
  }

  const bodyText = await response.text();
  console.log('Body:');
  console.log(bodyText || '<empty>');

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
