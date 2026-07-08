import type { FullConfig } from "@playwright/test";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3010/api";

  try {
    const response = await fetch(apiUrl, { method: "GET" });
    if (response.status >= 500) {
      throw new Error(`status ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Playwright E2E requires the API to be reachable at ${apiUrl}. Start it with npm run start:api before running npm run test:e2e --workspace=apps/web. Cause: ${(error as Error).message}`,
    );
  }
}
