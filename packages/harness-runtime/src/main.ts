/**
 * CLI entry point for harness-runtime container images.
 *
 * The HARNESS_ID environment variable determines which engine runs.
 * Engine modules must be imported before startKernel() so they can
 * self-register via registerEngine().
 *
 * For the PI image, the Dockerfile copies @nexus/harness-engine-pi into the
 * workspace and sets HARNESS_ID=pi; this file loads it dynamically so the
 * kernel entry point remains engine-agnostic.
 */

import { startKernel } from "./kernel.js";

const harnessId = process.env["HARNESS_ID"];
if (!harnessId) {
  console.error("HARNESS_ID environment variable is required");
  process.exit(1);
}

// Dynamically import the engine package so that it can self-register.
// The package name is resolved from the workspace node_modules at runtime.
const enginePackage = `@nexus/harness-engine-${harnessId}`;
await import(enginePackage).catch((err: unknown) => {
  console.error(`Failed to load engine package "${enginePackage}":`, err);
  process.exit(1);
});

startKernel().catch((err: unknown) => {
  console.error("Kernel startup failed:", err);
  process.exit(1);
});
