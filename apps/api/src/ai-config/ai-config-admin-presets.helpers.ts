/** Display names for known provider IDs — used in preset and preset-list APIs. */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  'amazon-bedrock': 'Amazon Bedrock',
  'azure-openai-responses': 'Azure OpenAI Responses',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  'github-copilot': 'GitHub Copilot',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi For Coding',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (China)',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openai: 'OpenAI',
  'openai-codex': 'ChatGPT Plus/Pro',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xai: 'xAI',
  zai: 'ZAI',
  xiaomi: 'Xiaomi MiMo',
  'xiaomi-token-plan-cn': 'Xiaomi MiMo Token Plan (China)',
  'xiaomi-token-plan-ams': 'Xiaomi MiMo Token Plan (Amsterdam)',
  'xiaomi-token-plan-sgp': 'Xiaomi MiMo Token Plan (Singapore)',
};

/** Supplemental OAuth endpoint data injected into provider presets. */
export const OAUTH_PRESET_DATA: Record<
  string,
  {
    oauth_authorization_url?: string;
    oauth_token_url?: string;
    oauth_scopes?: string[];
  }
> = {
  'openai-codex': {
    oauth_authorization_url: 'https://auth.openai.com/oauth/authorize',
    oauth_token_url: 'https://auth.openai.com/oauth/token',
    oauth_scopes: [],
  },
};

/** Convert a provider ID into a title-cased display name. */
export function formatProviderName(id: string): string {
  if (PROVIDER_DISPLAY_NAMES[id]) return PROVIDER_DISPLAY_NAMES[id];
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
