/**
 * Builds git environment variables for authenticated HTTPS operations.
 *
 * Uses the GIT_CONFIG_* env approach so token values are never exposed
 * as command-line arguments or in process listings.
 *
 * @param token - GitHub Personal Access Token (never logged)
 * @returns Environment variable record to merge with process.env for git commands
 */
export function buildGitAuthEnv(token: string): Record<string, string> {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}
