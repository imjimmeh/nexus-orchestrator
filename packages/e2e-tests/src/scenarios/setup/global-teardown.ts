// packages/e2e-tests/src/scenarios/setup/global-teardown.ts
export default async function teardown(
  stopFn: (() => Promise<void>) | undefined,
): Promise<void> {
  if (typeof stopFn === "function") {
    await stopFn();
  }
}
